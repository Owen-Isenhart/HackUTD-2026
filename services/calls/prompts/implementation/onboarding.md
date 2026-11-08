# Implementation prompt: ONBOARDING profile (phone call, Photon)

> Hand this whole file to your coding agent. Repo base: `main`. Work in `services/calls/` (agent) and your own service for the endpoint. Do not commit or push unless asked. Never put keys in files that are tracked; the repo is public. Prompt to implement: `services/calls/prompts/onboarding.txt`.

**Goal.** A new user signs up in the app. The backend phones them (Photon), the agent asks for their first and last name and the last four digits of their credit card, the backend verifies them against the Nessie sandbox and pulls their transactions, and the agent tells them in one sentence what it found. The call then ends by itself.

**How it fits the current call feature.** Same pipeline as today's calls (`POST /calls` -> LiveKit dispatch -> SIP -> `nessi-agent`). What changes: a profile (`onboarding`) selects the prompt, the allowed tools and the hang-up rules. The agent does **not** talk to Nessie. It forwards the caller's words through the existing `respond_to_caller` tool to your endpoint, which does the lookup. That keeps card and account data out of the model and the voice service.

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



## 1. Onboarding-specific work

### 1.1 Triggering the call
The app backend calls (authenticated, server to server):
```
POST /calls
{"to_number": "<the number the user registered>", "profile": "onboarding",
 "user_id": "<new user id>", "scenario": "New user onboarding.", "idempotency_key": "onboard-<user_id>"}
```
`identity_verified` stays `false`: onboarding is how identity gets established. The number must be on the allowlist (`DEMO_ALLOWED_NUMBERS`) for the demo; replace that with a per-user consent record before real users.

### 1.2 Agent side (`src/tools/onboarding.py` plus profile entry)
No new tool is needed. The profile exposes `respond_to_caller` and `record_decision` only. Confirm in a test that `save_call_note` and `check_connection` are **not** offered to the model in this profile. `record_decision(accepted=true)` is the "verified, all done" exit; `accepted=false` is "could not verify". Both say goodbye and end the call (already how `main` works).

### 1.3 The lookup endpoint (your service, behind `RECOMMENDATION_API_URL`)
Request from the agent: `{"user_id", "scenario", "user_text", "session_id", "profile": "onboarding"}`. `user_text` is one sentence such as "My name is Maya Lopez and the last four digits of my card are one two three four."

Steps, in order, all deterministic except step 1:
1. **Extract** `first`, `last` and `last4` from `user_text`. Use Nemotron for the free-text parsing only, with a JSON schema; then validate in code (`last4` must be exactly four digits after converting spoken digits like "one two three four"; names non-empty, length-limited).
2. **Nessie lookup**, server side only, key from `NESSIE_API_KEY` (never from the request, never logged). Verified against the sandbox on 2026-11-08: use **HTTPS** (`https://api.nessieisreal.com`; plain HTTP is refused). `GET /customers?key=...` lists customers (fields `_id`, `first_name`, `last_name`, `address`); `GET /customers/{id}/accounts?key=...` returns accounts (`_id`, `type`, `nickname`, `account_number` (16 digits), `balance`, `rewards`, `customer_id`); `GET /accounts/{id}/purchases?key=...` returns purchases (`_id`, `amount`, `description`, `merchant_id`, `purchase_date`, `status`, `type`, `medium`, `payer_id`); `GET /merchants?key=...` gives merchant names and categories. The sandbox demo customer has a **Checking** account and no credit card, so match the last four digits against **any** account's `account_number`, and say so in a code comment.
3. **Match** case-insensitively on first and last name, then on `account_number[-4:] == last4`. Compare with `hmac.compare_digest`. Never return or log the full account number.
4. **Respond** with JSON only, no sentences for the agent to parrot. Suggested shape:
```json
{"status": "verified", "transaction_count": 30,
 "date_range": {"from": "2026-10-01", "to": "2026-10-29"},
 "top_merchants": ["Chipotle", "Target"], "customer_id": "<nessie id>"}
```
`status` is one of `verified`, `not_found` (no match; **do not say which part failed**), `unavailable` (Nessie down, timeout, parse failure: the agent then says the fixed "We can't process that right now" line and does not count it as a failed match). Add `*_spoken` fields for anything with numbers or dates (see the phone plan's `speak_money`, `speak_date`).
5. **Remember the result** keyed by `session_id`: store `verified=true` and `customer_id`, with a short TTL (call length plus a few minutes). Persist the link `user_id <-> customer_id` through your own user service (TigerData, once verified); this plan does not build that.
6. **Abuse limits:** at most 5 verification attempts per `user_id` and per phone number per hour, enforced in the endpoint, not the prompt. After the limit return `status: "unavailable"` so the agent stops cleanly.

Transactions are imported in the background after `verified`; the call must not wait for the import. Return counts and date range from what you already fetched.

### 1.4 Tests (TDD)
- Endpoint: `test_extracts_name_and_last4_from_spoken_digits`, `test_rejects_non_four_digit_last4`, `test_verified_returns_counts_and_never_the_account_number`, `test_wrong_digits_and_wrong_name_both_return_not_found_with_same_body`, `test_nessie_timeout_returns_unavailable`, `test_attempt_limit_returns_unavailable`, `test_uses_https_and_server_side_key`. Fake the Nessie client; do not call the real API in unit tests.
- Agent: `test_onboarding_profile_hides_non_onboarding_tools`, `test_onboarding_record_decision_ends_the_call`, `test_onboarding_prompt_loaded_with_scenario_line`.
- Live (checklist, record results in `services/calls/docs/smoke-test.md`): (a) correct name and digits: expect a spoken confirmation with count and merchants, then goodbye and hang-up; (b) wrong digits twice: expect "I couldn't match those details", one retry, then a clean exit via `record_decision(false)`; (c) caller volunteers a full card number: expect the "please don't share that" interruption; (d) Nessie unreachable (point the endpoint at a bad URL): expect the fixed fallback line.

### 1.5 Acceptance
A real onboarding call completes end to end against the sandbox customer; the agent never says the card digits more than once, never names the field that failed, never invents a transaction; no name, digit or transaction appears in logs unless `LOG_TRANSCRIPTS=1`; the call always ends (goodbye then room deleted, 5 minute cap). The checklist items touched: ONBOARD-02, ONBOARD-03 (partial: goals/budget are a later conversation), DATA-03 (the Nessie import), SEC-04.

### 1.6 Pitfalls specific to this profile
- A bare "no" hangs up on `main` (`on_user_turn_completed`). The prompt avoids plain yes/no questions ("Say 'correct', or tell me the right digits"). Keep it that way when you edit the prompt.
- Name plus last four digits is weak authentication. Demo data only. Say so in your README and do not reuse this flow for real accounts.
- The agent opens with the model-written greeting (as on `main`). If the opening sounds odd, tune `profile.opening`, not the code.
- Outbound SIP participants join while the phone rings; the agent already waits for the answer. Do not add sleeps.
- The model has thinking off; if you change `NEMOTRON_MODEL` re-check tool calling first.
