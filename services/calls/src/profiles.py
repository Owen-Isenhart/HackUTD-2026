"""Per-session voice behavior. Dispatch metadata is set by the trusted calling backend."""
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Optional


PROMPT_DIR = Path(__file__).resolve().parents[1] / "prompts"


@dataclass(frozen=True)
class Profile:
    name: str
    prompt_file: str
    transport: str
    opening: Optional[str]
    end_phrase_hangup: bool
    decision_hangs_up: bool
    max_seconds: int
    tools: tuple[str, ...]
    knowledge_file: Optional[str] = None  # prompts/knowledge/<file>, appended to every session of this profile


@dataclass(frozen=True)
class CallContext:
    profile: str = 'phone_details'
    user_id: Optional[str] = None
    scenario: str = ''
    identity_verified: bool = False
    call_id: Optional[str] = None
    phone_number: Optional[str] = None
    # Set only by the inbound Tiger route or a seeded outbound call: answered by the lookup service,
    # which checks identity against the caller's own linked account.
    returning: bool = False


DEFAULT_PROFILE = 'phone_details'
PROFILES = {
    'onboarding': Profile('onboarding', 'onboarding.txt', 'phone',
        "Say exactly: Hi, I'm the Nessential agent, an AI assistant. Welcome to Nessential onboarding. What's your first and last name?",
        True, True, 300, ('respond_to_caller', 'record_decision')),
    'phone_details': Profile('phone_details', 'phone_details.txt', 'phone',
        'Greet the caller as the Nessential agent, an AI assistant. If identity is verified, say why you are calling; otherwise ask for their first and last name.',
        True, True, 600, ('respond_to_caller', 'record_decision', 'save_call_note')),
    'app_voice': Profile('app_voice', 'app_voice.txt', 'app', None,
        False, False, 1800, ('navigate_app',), 'alex.md'),
}


def get_profile(name: Optional[str]) -> Profile:
    return PROFILES.get(name, PROFILES[DEFAULT_PROFILE]) if isinstance(name, str) else PROFILES[DEFAULT_PROFILE]


@lru_cache
def load_prompt(profile: Profile) -> str:
    prompt = (PROMPT_DIR / profile.prompt_file).read_text(encoding="utf-8").strip()
    if not prompt:
        raise ValueError(f'Empty prompt for {profile.name}')
    return prompt


@lru_cache
def load_knowledge(profile: Profile) -> str:
    if not profile.knowledge_file:
        return ''
    return (PROMPT_DIR / 'knowledge' / profile.knowledge_file).read_text(encoding='utf-8').strip()


def build_instructions(profile: Profile, ctx: CallContext) -> str:
    knowledge = load_knowledge(profile)
    section = f"\n\nKNOWLEDGE (frozen snapshot of the user's data)\n{knowledge}" if knowledge else ''
    return load_prompt(profile) + section + (f'\nScenario: {ctx.scenario}' if ctx.scenario else '') + ('\nIdentity verified.' if ctx.identity_verified else '')
