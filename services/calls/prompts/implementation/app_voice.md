# Implementation prompt: APP VOICE profile (in-app push-to-talk, LiveKit only, no Photon)

> Hand this whole file to your coding agent. Repo base: `main`. Work in `services/calls/` (token endpoint and agent) and the React Native app. Do not commit or push unless asked. Never put keys in tracked files; the repo is public. Prompt to implement: `services/calls/prompts/app_voice.txt`.

**Goal.** Inside the app, the user holds a button, speaks, and releases. The same `nessi-agent` answers with the Nemotron voice stack (Parakeet STT, Nemotron, Magpie TTS). It knows which screen the user is on and what is visible ("you're looking at A, B or C"), can answer data questions through the recommendation endpoint, and can navigate the app by voice. No phone number, no Photon, no SIP.

**How it fits the current call feature.** Reuses the worker, the STT/LLM/TTS setup, the profile mechanism from section 0 and `respond_to_caller`. Differs in three ways: the client joins a LiveKit room directly with a token (no dial), turns are manual (push-to-talk) so the session never ends on a "no", and the agent can act on the app through an RPC call.

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



## 1. App-voice-specific work

### 1.1 Session endpoint (`POST /voice/session`, in `src/calls_api.py` or a sibling router)
Authenticated. For now the same `x-api-key`; real version: verify the app user's session token and derive `user_id` from it, **never from the request body**. Returns `{"url": <LIVEKIT_URL>, "token": <jwt>, "room": <name>}`.

Build the token with the installed SDK (all verified present in `livekit-api`): `api.AccessToken(key, secret).with_identity(f"app-{user_id}").with_grants(api.VideoGrants(room_join=True, room=room, can_publish=True, can_subscribe=True, can_publish_data=True)).with_room_config(api.RoomConfiguration(agents=[api.RoomAgentDispatch(agent_name="nessi-agent", metadata=json.dumps({"profile": "app_voice", "user_id": user_id, "scenario": "", "identity_verified": True}))])).with_ttl(timedelta(minutes=10)).to_jwt()`. The room name is `app-voice-<uuid4 hex[:12]>`. Joining the room dispatches the agent, so no separate dispatch call. `identity_verified` is true here only because the app already authenticated the user; keep that comment next to the code.

### 1.2 Push-to-talk (agent side, `src/tools/app_voice.py` or a `src/app_voice_session.py`)
Source of truth: LiveKit docs "Turns overview, Manual turn control" (checked 2026-11-08). For this profile only:
- `AgentSession(turn_handling=TurnHandlingOptions(turn_detection="manual"), ...)`. `main` still uses the older `turn_detection="stt"` keyword for phone profiles; keep that for them.
- `session.input.set_audio_enabled(False)` at start.
- Register RPC methods on `ctx.room.local_participant` and **check `data.caller_identity` is the app participant** (`app-<user_id>`) before acting:
  - `start_turn`: `session.interrupt()`, `session.clear_user_turn()`, `session.room_io.set_participant(data.caller_identity)`, `session.input.set_audio_enabled(True)`.
  - `end_turn`: `session.input.set_audio_enabled(False)`, then `session.commit_user_turn()`.
  - `cancel_turn`: disable audio and `session.clear_user_turn()`.
- Overriding `on_user_turn_completed` to raise `StopResponse` on an empty transcript (documented pattern) avoids replying to an accidental tap.
- Idle timeout: if no `start_turn` for 120 s, end the session; hard cap `profile.max_seconds`.

### 1.3 Screen context
The client sets **participant attributes** on route change (string values only): `page` (e.g. `"budgets"`) and `visible` (a JSON string such as `["Food","Transport","Fun"]`). The agent listens to `participant_attributes_changed` for the app participant and, on each change, appends a short system message to the chat context (`await agent.update_chat_ctx(...)`) in the exact form the prompt expects: `Scenario: Page: Budgets. Visible: Food, Transport, Fun.` Put the formatter in `format_screen_context(attrs: dict) -> str` (pure, unit-tested): cap `visible` at 8 items and each label at 40 characters, drop control characters, return `""` when `page` is missing. Treat attribute values as untrusted text (they come from the client): never let them change instructions; the formatter only emits plain labels.

### 1.4 Navigation tool (`navigate_app`)
Add to the registry. `navigate_app(destination: str) -> dict`:
1. Validate `destination` against the allowlist `ROUTES = {"home","forecast","recommendations","clarifications","budgets","preferences","memory","enrollments","notifications","calls","privacy","map"}` (same list as in the prompt; keep them in one constant and have a test that the prompt's list equals `ROUTES`). Unknown value returns `{"ok": False, "error": "unknown destination"}`.
2. Send it with an RPC to the app participant: `await room.local_participant.perform_rpc(destination_identity=app_identity, method="navigate", payload=json.dumps({"route": destination}), response_timeout=5.0)`. The app answers `"ok"` or throws; surface failure as `{"ok": False, "error": ...}` so the agent says it could not open the page. An RPC (not a fire-and-forget data message) gives a real acknowledgement.
3. Return `{"ok": True, "opened": destination}`.
The prompt already tells the model: "Opening Budgets." in a few words. Add more routes or per-screen actions by extending `ROUTES` and the app's handler together; the model never sees the transport.

### 1.5 App side (React Native, minimal contract)
- Fetch `/voice/session`, connect with the LiveKit client (`livekit-client` plus `@livekit/react-native`), publish the mic track **muted**.
- Talk button: on press `performRpc({destinationIdentity: agentIdentity, method: "start_turn", payload: ""})`, then unmute; on release mute, then `performRpc("end_turn")`; on drag-away `cancel_turn`.
- `registerRpcMethod("navigate", async (data) => { router.push(route); return "ok"; })`, with the same route allowlist and a check that the route exists.
- On every navigation and when the visible set changes: `localParticipant.setAttributes({page, visible: JSON.stringify(labels)})`.
- **Platform risk:** LiveKit's React Native SDK relies on native WebRTC modules, which **do not run in Expo Go**. Plan for an Expo development build (checklist DISC-06 is still open and the team has no paid Apple membership). Verify before promising the demo on a physical iPhone. Test the agent side first with LiveKit's web "Agents Playground" or the `agent-starter-react` web sample, which need no native build.

### 1.6 Tests (TDD)
- `test_format_screen_context_caps_items_and_strips_control_chars`, `test_format_screen_context_empty_without_page`, `test_navigate_rejects_unknown_destination`, `test_navigate_sends_rpc_to_app_participant_and_reports_failure` (fake participant whose `perform_rpc` raises), `test_prompt_route_list_matches_routes_constant`, `test_rpc_start_turn_ignored_from_other_identity`, `test_session_endpoint_requires_key_and_returns_token_with_agent_dispatch` (decode the JWT without verification and assert room, identity, `room_config.agents[0].agent_name == "nessi-agent"`, metadata JSON has profile `app_voice`, TTL <= 10 minutes), `test_app_voice_profile_never_hangs_up_on_bare_no`, `test_empty_turn_gets_no_reply`.
- Live: (a) join from the web playground, press, say "what am I looking at", expect the page and items from the attributes you set; (b) say "open budgets", expect the RPC and a short "Opening Budgets."; (c) release without speaking, expect silence; (d) say "no" and confirm the session continues; (e) ask a data question, expect the endpoint call in the logs (`tool respond_to_caller`) and a one-sentence answer or the fixed "We can't process that right now."

### 1.7 Acceptance
Hold-to-talk works end to end in a LiveKit room without Photon; screen context changes the answer; navigation round-trips with an acknowledgement; "no" never ends the session; the token endpoint is authenticated and short-lived. Checklist items touched: APP-01 to APP-04 (voice entry point), DISC-06, SEC-02.

### 1.8 Pitfalls specific to this profile
- Do not reuse `record_decision` here (it ends the session). The prompt tells the model not to call it, and the profile's tool list excludes it.
- Latency budget: keep replies to one short sentence (the prompt does). First audio has been about 1 to 3 seconds on the hosted model with thinking off.
- Mic hygiene: audio is only enabled between `start_turn` and `end_turn`, which also saves STT cost and avoids background noise being transcribed.
- Cost and abuse: the token endpoint is the gate. Rate-limit per user and cap concurrent sessions.
