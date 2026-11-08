"""Per-session voice behavior. Dispatch metadata is set by the trusted calling backend."""
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Optional


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


@dataclass(frozen=True)
class CallContext:
    profile: str = 'phone_details'
    user_id: Optional[str] = None
    scenario: str = ''
    identity_verified: bool = False
    call_id: Optional[str] = None
    phone_number: Optional[str] = None


DEFAULT_PROFILE = 'phone_details'
PROFILES = {
    'onboarding': Profile('onboarding', 'onboarding.txt', 'phone',
        "Say exactly: Welcome to Nessiessential onboarding with your AI assistant. What's your first and last name?",
        True, True, 300, ('respond_to_caller', 'record_decision')),
    'phone_details': Profile('phone_details', 'phone_details.txt', 'phone',
        'Greet the caller as an AI assistant. If identity is verified, say why you are calling; otherwise ask for their first and last name.',
        True, True, 600, ('respond_to_caller', 'record_decision', 'save_call_note')),
    'app_voice': Profile('app_voice', 'app_voice.txt', 'app', None,
        False, False, 1800, ('respond_to_caller', 'navigate_app')),
}


def get_profile(name: Optional[str]) -> Profile:
    return PROFILES.get(name, PROFILES[DEFAULT_PROFILE]) if isinstance(name, str) else PROFILES[DEFAULT_PROFILE]


@lru_cache
def load_prompt(profile: Profile) -> str:
    prompt = (Path(__file__).resolve().parents[1] / 'prompts' / profile.prompt_file).read_text().strip()
    if not prompt:
        raise ValueError(f'Empty prompt for {profile.name}')
    return prompt


def build_instructions(profile: Profile, ctx: CallContext) -> str:
    return load_prompt(profile) + (f'\nScenario: {ctx.scenario}' if ctx.scenario else '') + ('\nIdentity verified.' if ctx.identity_verified else '')
