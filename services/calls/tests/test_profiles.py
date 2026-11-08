import asyncio
from types import SimpleNamespace

import pytest
from livekit.agents import StopResponse
from src.agent import NessiAgent, parse_metadata
from src.profiles import CallContext, PROFILES, build_instructions, get_profile, load_prompt
from src.tools import TOOLS


def test_get_profile_unknown_falls_back_to_default():
    for name in (None, 'oops', [], {}):
        assert get_profile(name).name == 'phone_details'


def test_every_profile_prompt_loads_and_is_nonempty():
    for profile in PROFILES.values():
        assert load_prompt(profile).strip()
        assert set(profile.tools) <= TOOLS.keys()


@pytest.mark.parametrize('raw', [None, 'oops', '[]', 'null', '1', '{"user_id":[],"scenario":5,"identity_verified":"true","profile":{}}'])
def test_parse_metadata_tolerates_garbage(raw):
    assert parse_metadata(raw) == CallContext()


def test_build_instructions_adds_identity_line_only_when_flagged():
    p = get_profile('onboarding')
    assert '\nIdentity verified.' not in build_instructions(p, CallContext())
    assert build_instructions(p, CallContext(scenario='New user.', identity_verified=True)).endswith('\nScenario: New user.\nIdentity verified.')


def test_onboarding_profile_hides_non_onboarding_tools():
    agent = NessiAgent(None, 'room', profile=get_profile('onboarding'))
    assert {tool.info.name for tool in agent.tools} == {'respond_to_caller', 'record_decision'}


@pytest.mark.parametrize('name', PROFILES)
def test_phone_profiles_hang_up_on_bare_no_but_app_voice_does_not(name):
    agent = NessiAgent(None, 'room', profile=get_profile(name))
    started = []
    agent._start_hang_up = started.append
    turn = agent.on_user_turn_completed(None, SimpleNamespace(text_content='No.'))
    if name == 'app_voice':
        asyncio.run(turn)
        assert not started
    else:
        with pytest.raises(StopResponse):
            asyncio.run(turn)
        assert started


@pytest.mark.parametrize('name', PROFILES)
def test_record_decision_hangs_up_only_when_profile_says_so(name):
    agent = NessiAgent(None, 'room', profile=get_profile(name))
    started = []
    agent._onboarding_verified = True
    agent._start_hang_up = started.append
    if name == 'app_voice':
        assert asyncio.run(agent.record_decision(None, True)) == {'ok': True, 'accepted': True}
        assert not started
    else:
        with pytest.raises(StopResponse):
            asyncio.run(agent.record_decision(None, True))
        assert started


def test_onboarding_bound_call_does_not_forward_incomplete_turn():
    agent = NessiAgent(None, 'room', call_id='some-call', profile=get_profile('onboarding'))
    async def fail(*args):
        pytest.fail('Incomplete name must not be evaluated')
    agent._evaluate = fail
    asyncio.run(agent.on_user_turn_completed(None, SimpleNamespace(text_content='Maya')))


def test_onboarding_cannot_accept_without_verified_lookup():
    agent = NessiAgent(None, 'room', profile=get_profile('onboarding'))
    agent._start_hang_up = lambda _: pytest.fail('Must not claim success')
    assert asyncio.run(agent.record_decision(None, True))['ok'] is False


@pytest.mark.parametrize('text', ['My card is 1234 5678 9012 3456', 'one two three four five six seven eight', 'My CVV is 123'])
def test_onboarding_stops_sensitive_input_without_lookup(monkeypatch, text):
    said = []
    monkeypatch.setattr(NessiAgent, 'session', property(lambda _: SimpleNamespace(say=said.append)))
    agent = NessiAgent(None, 'room', profile=get_profile('onboarding'))
    with pytest.raises(StopResponse):
        asyncio.run(agent.on_user_turn_completed(None, SimpleNamespace(text_content=text)))
    assert said == ["Please don't share that. I only need the last four digits."]


def test_inbound_binds_pending_signup_even_when_phone_is_not_allowlisted(monkeypatch):
    from livekit import rtc
    monkeypatch.setenv('DEMO_ALLOWED_NUMBERS', '+19725550100')
    monkeypatch.setenv('ONBOARDING_API_URL', 'http://localhost:8790/api/recommendations/evaluate')
    seen = []
    def resolve(url, phone, session):
        seen.append((phone, session))
        return {'status': 'pending', 'user_id': 'registered-user'}
    monkeypatch.setattr('src.recommend.resolve_onboarding', resolve)
    agent = NessiAgent(None, 'room-inbound', profile=get_profile('onboarding'))
    participant = SimpleNamespace(kind=rtc.ParticipantKind.PARTICIPANT_KIND_SIP, attributes={'sip.ruleID': 'rule', 'sip.phoneNumber': '+19725550100'})
    assert asyncio.run(agent.bind_inbound_onboarding(participant))
    assert agent._user_id == 'registered-user'
    assert agent._phone_number == '+19725550100'
    assert not agent._onboarding_verified
    assert seen == [('+19725550100', 'room-inbound')]
    participant.attributes['sip.phoneNumber'] = '+19725550999'
    assert asyncio.run(agent.bind_inbound_onboarding(participant))
    assert agent._phone_number == '+19725550999'
    assert seen == [('+19725550100', 'room-inbound'), ('+19725550999', 'room-inbound')]


def test_unregistered_inbound_never_falls_back_to_demo_user(monkeypatch):
    from livekit import rtc
    monkeypatch.setenv('DEMO_ALLOWED_NUMBERS', '+19725550100')
    monkeypatch.setenv('ONBOARDING_API_URL', 'http://localhost:8790/api/recommendations/evaluate')
    monkeypatch.setattr('src.recommend.resolve_onboarding', lambda *args: {'status': 'unavailable'})
    agent = NessiAgent(None, 'room-inbound', profile=get_profile('onboarding'))
    participant = SimpleNamespace(kind=rtc.ParticipantKind.PARTICIPANT_KIND_SIP, attributes={'sip.ruleID': 'rule', 'sip.phoneNumber': '+19725550100'})
    assert not asyncio.run(agent.bind_inbound_onboarding(participant))
    assert agent._user_id is None


def test_prompt_mentions_only_registered_tools():
    import re
    for profile in PROFILES.values():
        referenced = set(re.findall(r'\b(?:respond_to_\w+|record_\w+|save_call_\w+|check_connection|navigate_app)\b', load_prompt(profile)))
        assert referenced <= TOOLS.keys()
        assert referenced <= set(profile.tools)


def test_onboarding_payload_carries_trusted_session_and_phone(monkeypatch):
    seen = {}
    monkeypatch.setenv('ONBOARDING_API_URL', 'http://localhost:8790/api/recommendations/evaluate')
    def evaluate(user, scenario, text, url, **metadata):
        seen.update(user=user, scenario=scenario, text=text, **metadata)
        return {'ok': True, 'result': {'status': 'verified'}}
    monkeypatch.setattr('src.recommend.evaluate_reply', evaluate)
    ctx = CallContext(profile='onboarding', user_id='registered', scenario='New user.', phone_number='+19725550100')
    agent = NessiAgent(None, 'trusted-room', ctx=ctx)
    asyncio.run(agent.respond_to_caller(None, 'My name is Maya Morgan and my last four digits are one two three four.'))
    assert seen['user'] == 'registered'
    assert seen['session_id'] == 'trusted-room'
    assert seen['phone_number'] == '+19725550100'
    assert seen['profile'] == 'onboarding'
    assert agent._onboarding_verified


@pytest.mark.parametrize(('accepted', 'failures', 'expected'), [
    (True, 0, "Onboarding successful. You can now get better insights into your finances through the app or phone calls. Goodbye."),
    (False, 2, "I couldn't verify your details. Please finish onboarding in the app. Goodbye."),
    (False, 0, "We can't process onboarding right now. Please try again later. Goodbye."),
    (False, 1, "We can't process onboarding right now. Please try again later. Goodbye."),
])
def test_onboarding_decision_speaks_one_fixed_outcome(accepted, failures, expected):
    agent = NessiAgent(None, 'room', profile=get_profile('onboarding'))
    agent._onboarding_verified = accepted
    agent._onboarding_failures = failures
    said = []
    agent._start_hang_up = said.append
    with pytest.raises(StopResponse):
        asyncio.run(agent.record_decision(None, accepted))
    assert said == [expected]
