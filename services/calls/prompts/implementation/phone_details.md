# Implementation prompt: PHONE DETAILS profile (existing user, phone call, no screen)

> Hand this whole file to your coding agent. Repo base: `main`. Work in `services/calls/` (agent) and your own service for the data endpoint. Do not commit or push unless asked. Never put keys in tracked files; the repo is public. Prompt to implement: `services/calls/prompts/phone_details.txt`.

**Goal.** An existing user can learn about their own data by phone without opening the app: either the system calls them (outbound) or they call the Photon number (inbound). The agent explains budgets, spending, forecast, deals and recommendations in spoken, descriptive detail, because the listener cannot see a screen.

**How it fits the current call feature.** This is the profile closest to what `main` already does: `POST /calls`, the SIP flow, `respond_to_caller`, `record_decision`, the hang-up rules. What is new is (a) the descriptive prompt, (b) an identity gate that is enforced **in code, not in the prompt**, and (c) spoken-ready values from the endpoint.

## 0. Foundation (identical in all three plans: land it once, skip it if `services/calls/src/profiles.py` already exists on `main`)

**Why.** `main` has one global prompt (`INSTRUCTIONS` in `src/agent.py`) and one fixed tool set on `NessiAgent`. The three profiles must run at the same time on one agent worker, each session choosing its own prompt, tools and behavior from the dispatch metadata. Agree who lands this block first; the other two rebase on it. It touches `agent.py` once so the profile-specific work (section 1+) lives in separate files and does not collide.

**What `main` does today (read these first):**
- `src/agent.py`: `INSTRUCTIONS` constant; `NessiAgent` (tools `check_connection`, `save_call_note`, `respond_to_caller`, `record_decision`; hang-up via `_start_hang_up`/`_hang_up`; `on_user_turn_completed` ends the call on a bare "no / that's all / goodbye"); `parse_metadata` returns `(scenario, user_id)`; `entrypoint` builds the `AgentSession` (Parakeet STT, Nemotron with thinking off, Magpie TTS, `turn_detection="stt"`), waits for the participant and, for SIP, until `sip.callStatus == "active"`, then `generate_reply(...)` as the opening.
- `src/livekit_dialer.py`: `LiveKitDialer.dial(room, to_number, scenario, user_id)` puts `{"user_id","scenario"}` in the dispatch metadata, then creates the SIP participant.
- `src/calls_api.py`: `POST /calls` with `CallRequest {to_number, scenario, user_id, idempotency_key}`.
- `src/recommend.py`: `evaluate_reply(...)` and `build_payload(...)` call the recommendation endpoint (`RECOMMENDATION_API_URL`, optional `RECOMMENDATION_API_KEY`); it returns `{"ok","source","result"}`.
- The prompts live in `services/calls/prompts/*.txt`. Context reaches the model as a line starting `Scenario:` appended to the prompt.

**F1. `src/profiles.py`**
```python
@dataclass(frozen=True)
class Profile:
    name: str                  # "onboarding" | "phone_details" | "app_voice"
    prompt_file: str           # file in services/calls/prompts/
    transport: str             # "phone" (Photon/SIP) | "app" (LiveKit only)
    opening: Optional[str]     # generate_reply instructions; None = stay silent until the user speaks
    end_phrase_hangup: bool    # a bare "no / that's all" ends the call
    decision_hangs_up: bool    # record_decision says goodbye and ends the session
    max_seconds: int
    tools: tuple[str, ...]     # names from the tool registry (F4)
PROFILES: dict[str, Profile]   # the three below
DEFAULT_PROFILE = "phone_details"
def get_profile(name: Optional[str]) -> Profile      # unknown/None -> default, never raises
def load_prompt(profile: Profile) -> str             # reads the .txt once (cached); raises if missing or empty
```
Values: `onboarding` = phone, opening "Greet the caller as an AI assistant, say you will set up their account, and ask for their first and last name.", hang-ups True/True, 300 s, tools `("respond_to_caller","record_decision")`. `phone_details` = phone, opening "Greet the caller as an AI assistant. If the Scenario says identity verified, say why you are calling; otherwise ask for their first and last name.", True/True, 600 s, tools `("respond_to_caller","record_decision","save_call_note")`. `app_voice` = app, opening `None`, False/False, 1800 s, tools `("respond_to_caller","navigate_app")`.

**F2. Metadata.** Dispatch metadata becomes JSON `{"profile","user_id","scenario","identity_verified"}`. Replace `parse_metadata` with a function returning a frozen `CallContext(profile: str, user_id: Optional[str], scenario: str, identity_verified: bool)`. It must tolerate `None`, non-JSON, non-dict and wrong types (defaults: `phone_details`, `None`, `""`, `False`). Inbound calls carry no metadata, so `user_id` is `None` and identity is unverified: do not fall back to a fake `demo-user` for data access.

**F3. `build_instructions(profile, ctx) -> str`** = `load_prompt(profile)` + `"\nScenario: " + ctx.scenario` (if any) + `"\nIdentity verified."` only when `ctx.identity_verified` is true. Only the backend can set that flag (F6).

**F4. Tool registry.** `src/tools/__init__.py` with `TOOLS: dict[str, Callable[[NessiAgent], Tool]]`, a `register(name)` decorator and `build_tools(names, agent) -> list`. Move the four existing tools to `src/tools/common.py` as factories that close over the agent (build them with `function_tool(handler, name=..., description=...)`, as LiveKit's own `EndCallTool` does, so the model sees only the profile's allowed tools). Each profile adds its own tool in its own module (`src/tools/onboarding.py`, `app_voice.py`, `phone_details.py`) and imports it in `tools/__init__.py`. First check the installed SDK (`uv run python -c "import inspect, livekit.agents as a; print(inspect.signature(a.function_tool))"`); if per-instance tools prove awkward, fall back to one `Agent` subclass per profile sharing a base class. Keep the observable behavior identical.

**F5. `NessiAgent(profile, ctx, room_name)` and `entrypoint`.** The agent takes its instructions from F3 and its tools from F4. `on_user_turn_completed` hangs up only when `profile.end_phrase_hangup`; `record_decision` hangs up only when `profile.decision_hangs_up`; the call-duration cap uses `profile.max_seconds`; `generate_reply(profile.opening)` is skipped when `opening is None`; the SIP "wait until answered" step runs only for SIP participants (it already checks `participant.kind`). Keep the logging, `asyncio.to_thread` for blocking HTTP, `session_close_transcript_timeout=0.1`, thinking off.

**F6. Dialing.** `POST /calls` gets `profile: Literal["onboarding","phone_details"] = "phone_details"` and `identity_verified: bool = False`. `app_voice` is rejected here (no phone). `Dialer.dial` and `LiveKitDialer.dial` carry `profile` and `identity_verified` into the metadata; update the fake dialer in tests. Only a trusted backend path may send `identity_verified=true` (outbound to the number registered for that `user_id`); document it in the docstring.

**F7. Endpoint payload.** `recommend.build_payload` adds `session_id` (the LiveKit room name) and `profile`. The endpoint uses `session_id` to keep per-call state (for example "this call is verified as customer X"). Update the dummy service (`services/recommend-dummy/app.py`) to accept and ignore the new fields.

**F8. Foundation tests** (add to `services/calls/tests/`):
`test_get_profile_unknown_falls_back_to_default`, `test_every_profile_prompt_loads_and_is_nonempty`, `test_prompt_mentions_only_registered_tools` (every tool name quoted in a prompt, except documented optional ones like `navigate_app`, exists in the registry), `test_parse_metadata_tolerates_garbage`, `test_inbound_metadata_is_unverified_with_no_user_id`, `test_build_instructions_adds_identity_line_only_when_flagged`, `test_phone_profiles_hang_up_on_bare_no_but_app_voice_does_not`, `test_record_decision_hangs_up_only_when_profile_says_so`, `test_calls_api_rejects_app_voice_and_unknown_profile`, `test_dialer_metadata_contains_profile_and_identity_flag`. All 54 + 4 existing tests must still pass (adapt the ones that touch `parse_metadata`/`dial`).



## 1. Phone-details-specific work

### 1.1 Two entry paths
- **Outbound** (system initiated, for example "your budget is nearly used up"): the trusted backend calls `POST /calls {"to_number": <registered number of the user>, "profile": "phone_details", "user_id": <id>, "identity_verified": true, "scenario": "<why we are calling, written as a short spoken sentence>"}`. Because the backend dialed the number registered to that user, `Identity verified.` is appended to the prompt context (F3) and the agent proceeds.
- **Inbound** (the user dials the Photon line): the LiveKit dispatch rule `SDR_fVNkUWNghqQH` already attaches `nessi-agent` (see `Calls.md`), but **the Photon inbound toggle was never confirmed in the dashboard, so inbound has never been tested.** Check that first (Photon Voice default profile: Inbound enabled to the LiveKit SIP address over TLS) and place one inbound call before building on it. Inbound sessions carry no metadata, so they get the default profile, `user_id=None` and no identity line: the prompt then makes the agent verify first. If you want a different profile for inbound calls (for example onboarding for unknown numbers), put it in the dispatch rule's room config metadata.

### 1.2 Identity gate (the important part)
A caller ID or a model that says "verified" is not proof. The agent verifies by asking for first and last name plus the last four card digits and sending them through `respond_to_caller` (this is what the prompt does). The **endpoint** then decides:
1. On a `verified` match it stores `{session_id -> customer_id, verified: true}` with a short TTL (this is the same lookup as the onboarding plan section 1.3: share that code; do not write it twice).
2. For every later request in that `session_id` it returns data only when the session is verified. Before that it returns `{"status": "unavailable"}`-style refusals, not account facts. For outbound calls with `identity_verified` the backend can pre-seed the session as verified by calling the same store when it places the call (use the `session_id`/room name returned by `POST /calls`).
3. It never takes a `customer_id` or account id from `user_text`; ids come from its own stored session or from `user_id` set by the trusted backend.

The agent code stays dumb: it forwards words and `session_id`. Add `test_endpoint_refuses_account_data_before_verification` and `test_endpoint_ignores_ids_spoken_by_the_caller` on the endpoint side.

### 1.3 Spoken-ready values (deterministic formatting, in the endpoint)
The prompt tells the model to say any field ending in `_spoken` exactly as written. Money and dates are exactly the kind of work code should do, not a 30B model with thinking off. In your endpoint add pure helpers and return both the raw and spoken form:
- `speak_money(minor_units: int, currency: str = "USD") -> str`: `24050` -> "two hundred forty dollars and fifty cents"; handle zero cents, one dollar, negatives ("minus"), and large amounts.
- `speak_date(d: date, today: date) -> str`: "today", "yesterday", "Tuesday, November eleventh".
- `speak_percent(value: float) -> str`.
Example field set: `{"amount_minor": 24050, "amount_spoken": "two hundred forty dollars and fifty cents", "due_date": "2026-11-11", "due_date_spoken": "Tuesday, November eleventh"}`. Keep money as integer minor units with currency in the raw fields (project rule).

### 1.4 Response shape guidance for the data endpoint
Return JSON facts, never sentences to read out. Group by what a listener needs: `answer` (the one number or fact asked for), `context` (what it means), `items` (at most three, most important first), `recommendation` (optional, with `reason`), `more_available` (how many items were left out, so the agent can offer them), `status` (`ok` | `unavailable`). The prompt limits the agent to three items per turn and two to four sentences, so do not return thirty rows. If a field is missing, omit it; the agent says it does not have it.

### 1.5 Agent side
`phone_details` exposes `respond_to_caller`, `record_decision` and `save_call_note`. Hang-up rules stay on (bare "no" ends the call), which is why the prompt avoids yes/no questions during explanations. Make sure the opening instruction from F1 works for both paths: outbound says why it is calling, inbound asks for the name. For inbound calls do not read the caller's number aloud or log it; if you want caller-ID lookup, use the SIP participant attribute `sip.phoneNumber` only as a **hint** to your user service, never as proof.

### 1.6 Tests (TDD)
- Foundation tests plus: `test_outbound_metadata_sets_identity_verified_and_prompt_context`, `test_inbound_gets_no_identity_line_and_no_user_id`, `test_phone_details_tools_are_respond_record_note_only`.
- Endpoint: `test_speak_money_cases` (0, 1, 99, 100, 24050, 100000, negative), `test_speak_date_relative_and_weekday`, `test_response_contains_spoken_fields_for_every_amount_and_date`, `test_items_capped_at_three_with_more_available_count`, plus the two verification tests above.
- Live: (a) outbound with `identity_verified=true`: expect a spoken reason for the call, then "what's left in my food budget" answered with the `_spoken` value, an either-or follow-up question, hang-up on "that'll be all"; (b) inbound (after the Photon toggle is confirmed): expect a request for name and last four, a refusal to share data until verified, one retry, then a clean exit; (c) ask a long question (spending breakdown): expect at most three items, a recap sentence and an offer for more; (d) say "no" mid-explanation: the call ends (known `main` behavior, the prompt avoids inviting it); (e) point the endpoint at a bad URL: expect the fixed "We can't process that right now. Any other questions?"

### 1.7 Acceptance
Both entry paths work on real calls; no account data is spoken before verification (outbound pre-verified by the backend or inbound verified by the endpoint); all numbers and dates the agent says come from `_spoken` fields; replies stay within about four sentences; every call ends cleanly. Checklist items touched: CALL-02, CALL-03 (partial), CALLS-04 (inbound), CALLS-06, FORECAST/APP data via the endpoint, SEC-02, SEC-04.

### 1.8 Pitfalls specific to this profile
- The identity rule lives in the endpoint. A prompt that merely says "verify first" can be argued around by a caller or ignored by a small model.
- Inbound is untested; also decide how an unknown number is treated (verify, or hand to the onboarding profile).
- Long explanations tempt the model into lists; the prompt caps items. If you add fields, do not add long arrays.
- Photon/LiveKit audio is 8 to 16 kHz speech: avoid asking callers to spell long strings; confirm digits one at a time.
- The first dial after a quiet period has twice returned SIP `403 permission_denied` and succeeded on an immediate retry (open item in `Calls.md`); build one bounded retry in the backend, not the agent.
