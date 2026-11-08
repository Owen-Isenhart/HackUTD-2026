import asyncio

import pytest

from src import tools as tool_registry
from src.agent import NessiAgent
from src.profiles import PROFILES, CallContext, build_instructions


def run(coro):
    return asyncio.run(coro)


class Msg:
    def __init__(self, text):
        self.text_content = text


def ids(agent):
    return {t.id for t in agent.tools}


def make(profile_name, scenario="s", user_id="alex", verified=False):
    profile = PROFILES[profile_name]
    ctx = CallContext(profile_name, user_id, scenario, verified, None)
    return NessiAgent(scenario, "room1", user_id, profile=profile, ctx=ctx)


def test_default_agent_is_phone_details_with_its_tool_allowlist():
    agent = NessiAgent("Budget is low.", "room1", "alex")
    assert agent.profile.name == "phone_details"
    assert ids(agent) == {"respond_to_caller", "record_decision", "save_call_note"}


def test_onboarding_exposes_only_lookup_and_decision_tools():
    assert ids(make("onboarding")) == {"respond_to_caller", "record_decision"}


def test_app_voice_never_exposes_phone_only_tools():
    got = ids(make("app_voice"))
    assert got <= set(PROFILES["app_voice"].tools)
    assert not got & {"record_decision", "save_call_note", "check_connection"}


def test_instructions_come_from_the_profile_prompt_plus_context():
    agent = make("app_voice", scenario="Page: Budgets. Visible: Food.")
    assert agent.instructions == build_instructions(
        PROFILES["app_voice"], CallContext("app_voice", "alex", "Page: Budgets. Visible: Food.", False, None))
    assert agent.instructions.endswith("\nScenario: Page: Budgets. Visible: Food.")


def test_identity_line_only_when_the_context_says_verified():
    assert "\nIdentity verified." not in make("phone_details").instructions
    assert make("phone_details", verified=True).instructions.endswith("\nIdentity verified.")


def test_bare_no_does_not_hang_up_the_app_voice_session():
    agent = make("app_voice")
    started = []
    agent._start_hang_up = lambda text: started.append(text)
    run(agent.on_user_turn_completed(None, Msg("No.")))  # must not raise StopResponse
    assert started == []


def test_bare_no_still_hangs_up_phone_profiles():
    from livekit.agents import StopResponse
    for name in ("onboarding", "phone_details"):
        agent = make(name)
        started = []
        agent._start_hang_up = lambda text, s=started: s.append(text)
        with pytest.raises(StopResponse):
            run(agent.on_user_turn_completed(None, Msg("No.")))
        assert started, name


def test_record_decision_hangs_up_only_when_profile_says_so():
    from livekit.agents import StopResponse
    phone = make("phone_details")
    started = []
    phone._start_hang_up = lambda text: started.append(text)
    with pytest.raises(StopResponse):
        run(phone.record_decision(None, True))
    assert started and phone.decision == "accepted"

    app = make("app_voice")
    app_started = []
    app._start_hang_up = lambda text: app_started.append(text)
    res = run(app.record_decision(None, False))  # not exposed to the model, but must be safe if called
    assert app_started == [] and res == {"ok": True, "accepted": False}


def test_registry_builds_only_registered_names_and_closes_over_the_agent():
    seen = []

    @tool_registry.register("unit_test_tool")
    def factory(agent):
        seen.append(agent)
        return "tool-object"

    try:
        sentinel = object()
        built = tool_registry.build_tools(("unit_test_tool",), sentinel)
        with pytest.raises(KeyError):
            tool_registry.build_tools(("not_registered",), sentinel)
        assert built == ["tool-object"] and seen == [sentinel]
    finally:
        tool_registry.TOOLS.pop("unit_test_tool", None)


def test_app_voice_carries_the_whole_snapshot_regardless_of_tab():
    text = make("app_voice", scenario="Page: Deals.").instructions
    for needle in ("Alex Taylor", "$3,412.67", "concert tickets", "Macy's", "2026-11-07 | JCPenney"):
        assert needle in text
    assert text.endswith("\nScenario: Page: Deals.")  # the live screen line stays last


def test_phone_profiles_do_not_get_the_app_snapshot():
    for name in ("onboarding", "phone_details"):
        assert "Alex Taylor" not in make(name).instructions
