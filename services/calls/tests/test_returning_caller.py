"""Returning callers: a number linked in Tiger to an onboarded user gets phone_details, not onboarding."""
import asyncio
import logging
import re
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from livekit import rtc
from livekit.agents import StopResponse

from src import agent as agent_module
from src.agent import (INBOUND_UNAVAILABLE, RETURNING_OPENING, RETURNING_REFERRAL, NessiAgent, opening_line,
                       phone_details_url, room_tag, route_inbound_call, voice_route_url)
from src.call_state import CallStore
from src.calls_api import create_app
from src.livekit_dialer import create_participant_with_retry
from src.profiles import PROFILES, CallContext, get_profile, load_prompt
from src.settings import load_settings

PHONE = '+19725550100'
ROOM = f'nessi-inbound_{PHONE}_Ab12'
LOOKUP = 'http://127.0.0.1:8790/api/recommendations/evaluate'


def sip(phone=PHONE, rule='SDR_rule'):
    attrs = {'sip.phoneNumber': phone}
    if rule:
        attrs['sip.ruleID'] = rule
    return SimpleNamespace(kind=rtc.ParticipantKind.PARTICIPANT_KIND_SIP, attributes=attrs, identity='caller')


@pytest.fixture
def lookup(monkeypatch):
    monkeypatch.setenv('ONBOARDING_API_URL', LOOKUP)
    monkeypatch.delenv('VOICE_ROUTE_URL', raising=False)
    monkeypatch.delenv('PHONE_DETAILS_API_URL', raising=False)
    seen = []

    def respond(result):
        def route(url, phone, session):
            seen.append((url, phone, session))
            return result
        monkeypatch.setattr('src.recommend.route_inbound', route)
    return respond, seen


def returning_agent(**overrides):
    ctx = CallContext(profile='phone_details', user_id='phone-abc', phone_number=PHONE, returning=True,
                      scenario='Returning registered caller calling in. Identity is not verified yet.', **overrides)
    return NessiAgent(None, ROOM, ctx=ctx)


def test_registered_number_routes_to_phone_details(lookup):
    respond, seen = lookup
    respond({'status': 'registered', 'profile': 'phone_details', 'user_id': 'phone-abc'})
    ctx = asyncio.run(route_inbound_call(sip(), ROOM))
    assert ctx.profile == 'phone_details'
    assert ctx.user_id == 'phone-abc'
    assert ctx.phone_number == PHONE
    assert ctx.identity_verified is False, 'caller ID never verifies'
    assert ctx.returning is True
    assert seen == [('http://127.0.0.1:8790/internal/voice/route', PHONE, ROOM)]


def test_new_number_routes_to_onboarding(lookup):
    respond, _ = lookup
    respond({'status': 'pending', 'profile': 'onboarding', 'user_id': 'phone-new'})
    ctx = asyncio.run(route_inbound_call(sip(), ROOM))
    assert (ctx.profile, ctx.user_id) == ('onboarding', 'phone-new')


@pytest.mark.parametrize('result', [
    {'status': 'unavailable'},
    {'status': 'registered', 'profile': 'onboarding', 'user_id': 'u'},
    {'status': 'registered', 'profile': 'app_voice', 'user_id': 'u'},
    {'status': 'registered', 'profile': 'phone_details', 'user_id': 'bad id; drop'},
    {'status': 'registered', 'profile': 'phone_details'},
    'not a dict',
])
def test_bad_route_results_are_unavailable(lookup, result):
    respond, _ = lookup
    respond(result)
    assert asyncio.run(route_inbound_call(sip(), ROOM)) is None


def test_hidden_number_or_non_rule_participant_is_never_routed(lookup):
    respond, seen = lookup
    respond({'status': 'registered', 'profile': 'phone_details', 'user_id': 'u'})
    assert asyncio.run(route_inbound_call(sip(phone=''), ROOM)) is None
    assert asyncio.run(route_inbound_call(sip(rule=None), ROOM)) is None
    standard = SimpleNamespace(kind=rtc.ParticipantKind.PARTICIPANT_KIND_STANDARD, attributes={'sip.ruleID': 'r', 'sip.phoneNumber': PHONE})
    assert asyncio.run(route_inbound_call(standard, ROOM)) is None
    assert seen == []


def test_lookup_urls_derive_from_onboarding_url_or_explicit_env(monkeypatch):
    monkeypatch.setenv('ONBOARDING_API_URL', LOOKUP)
    monkeypatch.delenv('VOICE_ROUTE_URL', raising=False)
    monkeypatch.delenv('PHONE_DETAILS_API_URL', raising=False)
    assert voice_route_url() == 'http://127.0.0.1:8790/internal/voice/route'
    assert phone_details_url() == 'http://127.0.0.1:8790/api/voice/phone-details'
    monkeypatch.setenv('PHONE_DETAILS_API_URL', 'https://lookup.example/api/voice/phone-details')
    assert phone_details_url() == 'https://lookup.example/api/voice/phone-details'


def test_returning_payload_carries_worker_bindings_not_model_args(lookup, monkeypatch):
    seen = {}

    def evaluate(user, scenario, text, url, **metadata):
        seen.update(user=user, text=text, url=url, **metadata)
        return {'ok': True, 'source': 'api', 'result': {'status': 'verified'}}
    monkeypatch.setattr('src.recommend.evaluate_reply', evaluate)
    agent = returning_agent()
    asyncio.run(agent.respond_to_caller(None, 'Maya Lopez zero one two three'))
    assert seen['url'] == 'http://127.0.0.1:8790/api/voice/phone-details'
    assert (seen['user'], seen['session_id'], seen['phone_number'], seen['profile']) == ('phone-abc', ROOM, PHONE, 'phone_details')
    assert agent._details_verified


def test_returning_caller_cannot_accept_before_verification():
    agent = returning_agent()
    agent._start_hang_up = lambda _: pytest.fail('must not end as accepted')
    assert asyncio.run(agent.record_decision(None, True)) == {'ok': False, 'status': 'identity_required'}


def test_second_mismatch_ends_with_app_referral(monkeypatch):
    results = iter([{'status': 'not_matched', 'retries_left': 1}, {'status': 'not_matched', 'retries_left': 0}])
    monkeypatch.setattr('src.recommend.evaluate_reply', lambda *a, **k: {'ok': True, 'result': next(results)})
    agent = returning_agent()
    asyncio.run(agent.respond_to_caller(None, 'Maya Lopez 9999'))
    asyncio.run(agent.respond_to_caller(None, 'Maya Lopez 9998'))
    assert agent._details_failures == 2
    # A third attempt never reaches the lookup service.
    monkeypatch.setattr('src.recommend.evaluate_reply', lambda *a, **k: pytest.fail('locked'))
    assert asyncio.run(agent.respond_to_caller(None, 'Maya Lopez 1111'))['ok'] is False
    said = []
    agent._start_hang_up = said.append
    with pytest.raises(StopResponse):
        asyncio.run(agent.record_decision(None, False))
    assert said == [RETURNING_REFERRAL]


def test_verified_returning_caller_decision_says_normal_goodbye(monkeypatch):
    agent = returning_agent()
    agent._details_verified = True
    said = []
    agent._start_hang_up = said.append
    with pytest.raises(StopResponse):
        asyncio.run(agent.record_decision(None, True))
    assert said == ['Got it, thank you. Goodbye!']


def test_plain_phone_details_calls_are_not_returning_sessions():
    agent = NessiAgent(None, 'nessi-out-2', ctx=CallContext(profile='phone_details', user_id='demo-user', phone_number=PHONE))
    assert not agent._returning


def test_parse_metadata_reads_returning_flag_strictly():
    from src.agent import parse_metadata
    assert parse_metadata('{"profile": "phone_details", "returning": true}').returning is True
    assert parse_metadata('{"profile": "phone_details", "returning": "yes"}').returning is False


def test_outbound_identity_verified_starts_verified():
    assert returning_agent(identity_verified=True)._details_verified


@pytest.mark.parametrize('text', ['My card is 4111 1111 1111 1111', 'my PIN is 1234'])
def test_sensitive_input_never_forwarded_for_returning_callers(monkeypatch, text):
    said = []
    monkeypatch.setattr(NessiAgent, 'session', property(lambda _: SimpleNamespace(say=said.append)))
    monkeypatch.setattr('src.recommend.evaluate_reply', lambda *a, **k: pytest.fail('must not forward'))
    agent = returning_agent()
    with pytest.raises(StopResponse):
        asyncio.run(agent.on_user_turn_completed(None, SimpleNamespace(text_content=text)))
    assert said == ["Please don't share that. I only need the last four digits."]


def test_bound_recommendation_calls_keep_their_route(monkeypatch):
    monkeypatch.setenv('RECOMMENDATION_API_URL', 'http://127.0.0.1:8787/api/recommendations/evaluate')
    monkeypatch.setenv('ONBOARDING_API_URL', LOOKUP)
    agent = NessiAgent(None, 'nessi-out-1', call_id='3f1c6d8e-7c39-4c1e-9f55-2a6f9a1d2b3c', profile=get_profile('phone_details'))
    assert not agent._returning
    assert agent._api_url == 'http://127.0.0.1:8787/api/recommendations/evaluate'


def test_phone_details_tools_are_respond_record_note_only():
    assert PROFILES['phone_details'].tools == ('respond_to_caller', 'record_decision', 'save_call_note')
    names = {tool.info.name if hasattr(tool, 'info') else tool.name for tool in returning_agent().tools}
    assert names == {'respond_to_caller', 'record_decision', 'save_call_note'}


def test_room_name_with_phone_number_is_not_logged(monkeypatch, caplog):
    monkeypatch.setattr('src.recommend.evaluate_reply', lambda *a, **k: {'ok': True, 'source': 'api', 'result': {'status': 'identity_required'}})
    agent = returning_agent()
    with caplog.at_level(logging.INFO, logger='nessi.agent'):
        asyncio.run(agent.respond_to_caller(None, 'what is my balance'))
    assert caplog.records
    assert '9725550100' not in caplog.text
    assert room_tag(ROOM) in caplog.text


def test_spoken_brand_is_nessential_everywhere():
    spoken = [load_prompt(p) for p in PROFILES.values()] + [p.opening or '' for p in PROFILES.values()]
    spoken += [RETURNING_OPENING, RETURNING_REFERRAL, INBOUND_UNAVAILABLE, opening_line('x')]
    source = Path(agent_module.__file__).read_text(encoding='utf8')
    for text in spoken + [source]:
        assert not re.search(r'Nessie?ss?ential|Nessessential', text), text[:80]
    assert 'Nessential agent' in RETURNING_OPENING
    assert 'Nessential agent' in PROFILES['onboarding'].opening
    assert opening_line(None).startswith("Hi, I'm the Nessential agent")


ENV = {
    'LIVEKIT_URL': 'wss://x.livekit.cloud', 'LIVEKIT_API_KEY': 'k', 'LIVEKIT_API_SECRET': 's',
    'NVIDIA_API_KEY': 'n', 'LIVEKIT_OUTBOUND_TRUNK_ID': 'ST_QwVKCdLTwF7b', 'CALLS_API_KEY': 'secret',
    'DEMO_ALLOWED_NUMBERS': PHONE,
}


class RecordingDialer:
    def __init__(self):
        self.calls = []

    async def dial(self, room_name, to_number, scenario=None, user_id='demo-user', **metadata):
        self.calls.append((room_name, metadata))


@pytest.mark.parametrize('seeded', [True, False])
def test_outbound_phone_details_is_seeded_before_dialing(seeded):
    order, dialer = [], RecordingDialer()

    def seed(room, user, number):
        order.append(('seed', room, user, number))
        assert not dialer.calls, 'seed must happen before the phone rings'
        return seeded
    client = TestClient(create_app(load_settings(ENV), dialer, CallStore(), seed_session=seed))
    body = {'to_number': PHONE, 'profile': 'phone_details', 'user_id': 'phone-abc', 'identity_verified': True,
            'scenario': 'Your budget is nearly used up.'}
    response = client.post('/calls', json=body, headers={'x-api-key': 'secret'})
    assert response.status_code == 200
    room = response.json()['room_name']
    assert order == [('seed', room, 'phone-abc', PHONE)]
    assert dialer.calls[0][1]['identity_verified'] is seeded
    assert dialer.calls[0][1].get('returning', False) is seeded


def test_unverified_or_other_profiles_are_not_seeded():
    dialer = RecordingDialer()
    client = TestClient(create_app(load_settings(ENV), dialer, CallStore(), seed_session=lambda *a: pytest.fail('no seed')))
    assert client.post('/calls', json={'to_number': PHONE, 'user_id': 'u'}, headers={'x-api-key': 'secret'}).status_code == 200
    assert dialer.calls[0][1]['identity_verified'] is False


class PermissionDenied(Exception):
    code = 'permission_denied'


def test_dialer_retries_once_on_sip_403_only():
    attempts = []

    async def flaky(request):
        attempts.append(request)
        if len(attempts) == 1:
            raise PermissionDenied()
        return 'ok'
    assert asyncio.run(create_participant_with_retry(flaky, 'req', delay=0)) == 'ok'
    assert attempts == ['req', 'req']

    async def always(request):
        attempts.append(request)
        raise PermissionDenied()
    attempts.clear()
    with pytest.raises(PermissionDenied):
        asyncio.run(create_participant_with_retry(always, 'req', delay=0))
    assert len(attempts) == 2

    async def busy(request):
        attempts.append(request)
        raise RuntimeError('busy')
    attempts.clear()
    with pytest.raises(RuntimeError):
        asyncio.run(create_participant_with_retry(busy, 'req', delay=0))
    assert len(attempts) == 1
