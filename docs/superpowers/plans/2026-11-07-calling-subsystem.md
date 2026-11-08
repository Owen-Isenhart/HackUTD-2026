# Nessiessential Calling Subsystem Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A caller can phone Nessiessential and talk to a Nemotron-driven agent, the backend can dial an allowlisted number that talks to the same agent, and in either call the agent runs a verifiable Python tool.

**Architecture:** LiveKit Agents (Python) runs `nessi-agent` with NVIDIA STT, Nemotron (OpenAI-compatible endpoint) and NVIDIA Magpie TTS. Photon SIP trunks (already created) bridge phone calls into LiveKit rooms. A small FastAPI service dispatches the agent to a fresh room, then creates the SIP participant. All policy logic (number validation, allowlist, idempotency, state, tools) is plain Python behind interfaces so it is unit-testable without telephony.

**Tech Stack:** Python >=3.10, uv, `livekit-agents[nvidia,openai]~=1.8`, `livekit-api`, FastAPI, uvicorn, python-dotenv, pytest, httpx (TestClient), LiveKit CLI (`lk`, not yet installed on this machine).

**Spec:** `C:\Users\Hi\Downloads\Nessiessential_Calling_Implementation_Handoff.md` (source of truth; "handoff" below). Broader product spec: `context.md`, `spec-checklist.md` (calls map to ONBOARD-02, CALL-01..03; this milestone does not close them).

## Global Constraints

- Scope (updated after interview): calls plus the demo conversation tools. No frontend or GPS. Nessie/TigerData appear only behind swappable interfaces (Task 7b). No ElevenLabs.
- Demo flow (interview): backend dials a number supplied by the team (consent is the team's responsibility; the number goes on the allowlist). Agent opens with a scenario passed in the `POST /calls` body (e.g. "Chick-fil-A is nearby with this reward"). Judge replies in speech (e.g. "I don't like fast food"); Nemotron turns it into a typed preference; a tool saves it and calls the recommendation API; the agent speaks the new result. Judge may also accept/decline; that outcome is stored on the call record. Money data comes from a Nessie sandbox profile, preferences from TigerData, once each is verified (DISC-03/04); until then local stand-ins behind the same interfaces, labeled as such on the call.
- Recommendation API is not defined yet. Until `RECOMMENDATION_API_URL` is set the tool returns `{"ok": True, "source": "stub", ...}` and the agent must say it is a placeholder. Never present stub output as a real recommendation.
- Tool failure UX: agent says honestly it could not fetch/save and offers to retry; never guesses numbers. Latency target: reply within 3 s of the caller finishing.
- Agent opens every call by identifying itself as an AI assistant. No audio recording.
- Nessie API key lives only in untracked `.env.local` as `NESSIE_API_KEY`; it was pasted in chat, so treat as exposed and rotate after the hackathon.
- Reuse, never recreate: number `+15076169071`; inbound trunk `ST_ZgnGygMAx8Gs`; outbound trunk `ST_QwVKCdLTwF7b`; dispatch rule `SDR_fVNkUWNghqQH`; Photon profile `pho_vpf_01m6wh9wjafvk94ang2a51egy6`; Photon project `pho_prj_01m6wh04gseh78gcs73agt2kj6`; LiveKit SIP host `sips:6c26ulfdp8h.sip.livekit.cloud` (TLS); agent name exactly `nessi-agent`.
- `LIVEKIT_URL` is a `wss://` URL, never the SIP host.
- Env vars: `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `NVIDIA_API_KEY`, `NEMOTRON_BASE_URL` (default `https://integrate.api.nvidia.com/v1`), `NEMOTRON_MODEL` (default `nvidia/nemotron-3.5-lightning-30b-a3b`), `LIVEKIT_OUTBOUND_TRUNK_ID` (`ST_QwVKCdLTwF7b`), `CALLS_API_KEY`, `DEMO_ALLOWED_NUMBERS` (comma-separated E.164), `DEMO_NOTES_DB`, `RECOMMENDATION_API_URL` (blank = stub), `NESSIE_API_KEY`.
- Secrets only in untracked `.env.local`; never in repo, logs, screenshots, or the handoff. Photon SIP password was exposed in chat: rotate it (Task 1).
- STT default is Parakeet, not Nemotron ASR; never label the pipeline "Nemotron ASR".
- Dial only consenting test numbers. `POST /calls` returns `dial_requested`, never `answered`. Never dial `+15076169071` (loops into own inbound line).
- **No git commits or pushes** (repo rule). Every task's last step is a `git status` check instead of a commit.
- Distinguish `CONFIGURED` from `TESTED`/`VERIFIED`; record real evidence and blockers in `services/calls/docs/smoke-test.md`; never mark a test passed without evidence.
- Brev: user has a Brev instance `following-copper-silkworm` (reach with `brev shell following-copper-silkworm --org <org-name>`; org name still needed, and it is not yet known what model/endpoint runs there). It is an optional self-hosted Nemotron route only: the hosted NVIDIA API stays the baseline and Brev is never a gate for the first call. To switch later, verify the instance serves an OpenAI-compatible `/v1` endpoint with tool calling, is reachable from LiveKit Cloud, and measure latency, then point `NEMOTRON_BASE_URL`/`NEMOTRON_MODEL` at it. Record results in `smoke-test.md`.
- Photon docs: use the version that matches the CLI/API in use (Stable by default; the handoff cites the Beta cookbook `photon.codes/docs/beta/cookbooks/voice/livekit`). State which version was used in `smoke-test.md`.

## Review Focus

1. Phone numbers typed as `(972) 555-0100`, `972-555-0100`, or `+1 972 555 0100`: normalized before the allowlist check, never rejected for formatting alone and never matched loosely (T10).
2. Same `POST /calls` retried (same idempotency key): exactly one dial, same `call_id` returned.
3. LiveKit dial raises: status becomes `failed`, response is an error, never `dial_requested` left dangling.
4. Tool raises or DB write fails: tool returns an error the agent can voice; no success claim without read-back.
5. Request to dial the Photon number itself, or a number not on the allowlist, or missing/wrong `x-api-key`: rejected with no dial.

## File Structure (all under `services/calls/`)

| File | Responsibility |
|---|---|
| `pyproject.toml`, `.gitignore`, `.env.local.example` | Deps, ignores (`.env.local`, `*.sqlite3`), env contract |
| `src/settings.py` | Typed env loading/validation |
| `src/numbers.py` | E.164 normalization, allowlist check |
| `src/demo_tools.py` | Harmless tool logic, SQLite notes with read-back |
| `src/call_state.py` | Call status enum, transitions, idempotent store, rate limit |
| `src/calls_api.py` | FastAPI app factory, auth, `Dialer` protocol |
| `src/livekit_dialer.py` | Real `Dialer`: dispatch agent then SIP participant |
| `src/agent.py` | LiveKit `nessi-agent`, NVIDIA pipeline, tool wrappers |
| `tests/test_*.py` | One file per module above |
| `docs/smoke-test.md` | Evidence log for T01-T12 |

Prototype: `C:\Users\Hi\Downloads\nessi_call_mvp.zip` (scaffold only). Unzip to a scratch dir, read it, borrow what holds up; do not copy blindly.

---

### Task 1: Provider gate (Phase A, no code)

**Files:** Create `services/calls/docs/smoke-test.md` with a T01-T12 table (status column starts `NOT RUN`).

**Interfaces:** Produces the evidence log other tasks append to.

- [ ] **Step 1:** In Photon Voice default profile, confirm Outbound enabled and Inbound enabled to `sips:6c26ulfdp8h.sip.livekit.cloud`, TLS. Record screenshot filename (no credentials visible) under T01.
- [ ] **Step 2:** Rotate the Photon SIP password; update the LiveKit outbound trunk `ST_QwVKCdLTwF7b` and inbound auth to match (directions are independent but must each match their counterpart). Record "rotated" without the value.
- [ ] **Step 3:** In LiveKit, confirm trunk numbers, outbound gateway `sip.photon.codes:5061` TLS, media encryption Allow; confirm `SDR_fVNkUWNghqQH` exists. Record `Agents: —` as current state. Do not create a second inbound rule.
- [ ] **Step 4:** Install LiveKit CLI (`lk`), run `lk cloud auth`, `lk project list`; confirm the Nessiessential project is the default. Run `npx @photon-ai/cli whoami` after `login` (user runs `! npx @photon-ai/cli login`).
- [ ] **Step 5:** Mark T01 `CONFIGURED` (not `TESTED`). `git status` shows only `docs/` changes; do not commit.

### Task 2: Scaffold and settings

**Files:** Create `pyproject.toml`, `.gitignore`, `.env.local.example`, `src/__init__.py`, `src/settings.py`, `tests/test_settings.py`.

**Interfaces:** Produces `Settings` (frozen dataclass: `livekit_url, livekit_api_key, livekit_api_secret, nvidia_api_key, nemotron_base_url, nemotron_model, outbound_trunk_id, calls_api_key: str; allowed_numbers: frozenset[str]; notes_db: str`) and `load_settings(env: Mapping[str, str]) -> Settings`, raising `ValueError` naming the missing variable.

- [ ] **Step 1:** `uv init`, then `uv add "livekit-agents[nvidia,openai]~=1.8" livekit-api fastapi uvicorn python-dotenv` and `uv add --dev pytest httpx`. If `lk agent init` starter layout differs (`src/agent.py` entrypoint, Dockerfile), reconcile per handoff 3.2/5 and note the choice in `smoke-test.md`.
- [ ] **Step 2:** Write failing tests: `test_load_settings_defaults` (omitting `NEMOTRON_BASE_URL`/`NEMOTRON_MODEL` yields the Global Constraints defaults), `test_missing_required_names_variable` (`pytest.raises(ValueError, match="CALLS_API_KEY")`), `test_livekit_url_must_be_wss` (a `sips:` value raises `ValueError`), `test_allowed_numbers_parsed_and_normalized` (`"+19725550100, +14695550101"` gives two entries).
- [ ] **Step 3:** Run `uv run pytest tests/test_settings.py -v`; expect FAIL (module missing).
- [ ] **Step 4:** Implement `load_settings` (allowed numbers normalized via `numbers.normalize_e164` once Task 3 exists; until then plain strip, then update in Task 3).
- [ ] **Step 5:** Run tests; expect PASS. `.env.local.example` lists every variable above with empty values. `git status` check; no commit.

### Task 3: Number validation and allowlist

**Files:** Create `src/numbers.py`, `tests/test_number_validation.py`.

**Interfaces:** Produces `normalize_e164(raw: str, default_region_code: str = "1") -> str` (raises `ValueError`) and `is_allowed(number: str, allowed: frozenset[str]) -> bool`. Consumed by Tasks 2, 5.

- [ ] **Step 1:** Failing tests: `test_formats_normalize` (`"(972) 555-0100"`, `"972-555-0100"`, `"+1 972 555 0100"` all give `"+19725550100"`); `test_rejects_garbage` (`""`, `"abc"`, `"+1"`, `"+1972555"`, 20-digit string raise `ValueError`); `test_is_allowed_uses_normalized_form`; `test_photon_number_never_allowed` (`is_allowed("+15076169071", frozenset({"+15076169071"}))` is `False`).
- [ ] **Step 2:** Run; expect FAIL. **Step 3:** Implement with stdlib regex (NANP + `+` E.164, 8-15 digits); hardcode the Photon number as a denylist constant `OWN_NUMBER`. **Step 4:** Run; expect PASS; re-run Task 2 tests.
- [ ] **Step 5:** `git status` check; no commit.

### Task 4: Demo tools with verifiable read-back

**Files:** Create `src/demo_tools.py`, `tests/test_tool_invocation.py`.

**Interfaces:** Produces `check_connection() -> dict` (`{"ok": True, "service": "nessi-calls"}`), `save_call_note(db_path: str, call_id: str, note: str) -> dict` returning `{"ok": True, "note_id": int, "note": str}` only after reading the row back, `get_call_note(db_path: str, note_id: int) -> str | None`. Errors return `{"ok": False, "error": str}` and never raise to the agent.

- [ ] **Step 1:** Failing tests: `test_check_connection`; `test_save_then_independent_readback` (save, then `get_call_note` on a fresh connection equals the text); `test_save_failure_reports_error` (db path in a nonexistent directory gives `ok False`, no `note_id`); `test_note_length_limited` (over 500 chars rejected); `test_empty_note_rejected`.
- [ ] **Step 2:** Run; FAIL. **Step 3:** Implement with `sqlite3`, parameterized SQL, create table on first use. **Step 4:** Run; PASS.
- [ ] **Step 5:** `git status` check; no commit. (SQLite is per-instance demo state only; say so in the module docstring.)

### Task 5: Call state store

**Files:** Create `src/call_state.py`, `tests/test_call_state.py`.

**Interfaces:** Produces `CallStatus` (str enum: `dial_requested, ringing, answered, ended, busy, no_answer, failed, canceled`), `CallRecord` (dataclass: `call_id, room_name, to_number, status, idempotency_key, created_at`), `CallStore` with `create(idempotency_key: str, to_number: str, room_name: str) -> tuple[CallRecord, bool]` (bool = newly created), `update(call_id: str, status: CallStatus) -> CallRecord`, `get(call_id: str) -> CallRecord | None`, `recent_count(to_number: str, window_s: int) -> int`.

- [ ] **Step 1:** Failing tests: `test_create_is_idempotent` (same key twice gives same `call_id`, second tuple flag `False`); `test_terminal_status_is_final` (after `ended`, `update(..., answered)` raises `ValueError`); `test_get_unknown_returns_none`; `test_recent_count_window`.
- [ ] **Step 2:** Run; FAIL. **Step 3:** In-memory dict guarded by `threading.Lock`; terminal = `ended, busy, no_answer, failed, canceled`. **Step 4:** Run; PASS.
- [ ] **Step 5:** `git status` check; no commit.

### Task 6: Authenticated `POST /calls` API

**Files:** Create `src/calls_api.py`, `tests/test_call_authorization.py`.

**Interfaces:** Consumes Tasks 2, 3, 5. Produces `Dialer` Protocol (`async def dial(self, room_name: str, to_number: str) -> None`, raises on failure) and `create_app(settings: Settings, dialer: Dialer, store: CallStore) -> FastAPI`. Routes: `GET /health` (no auth) `{"status":"ok"}`; `POST /calls` body `{"to_number": str, "scenario": str | None, "idempotency_key": str | None}` (`scenario` max 500 chars, stored on the record, passed to the agent as dispatch metadata) header `x-api-key`; `GET /calls/{call_id}` (auth). `POST` success returns 200 `{"call_id","room_name","status":"dial_requested"}`. Errors: 401 bad/missing key, 422 bad number, 403 not allowlisted/own number, 429 over `3` calls per recipient per `600` s, 502 dial failure (record set to `failed`).

- [ ] **Step 1:** Failing tests using a `FakeDialer` that records calls: `test_missing_key_401_no_dial`; `test_wrong_key_401_no_dial`; `test_non_allowlisted_403_no_dial`; `test_own_photon_number_403`; `test_bad_number_422`; `test_formatted_number_matches_allowlist` (`"(972) 555-0100"` dials `+19725550100`); `test_success_returns_dial_requested_once`; `test_retry_same_idempotency_key_dials_once`; `test_dialer_error_sets_failed_and_502` (store status `failed`); `test_rate_limit_429`; `test_get_call_requires_key`; `test_health_open`.
- [ ] **Step 2:** Run; FAIL. **Step 3:** Implement; room name `nessi-out-<uuid4 hex[:12]>`; compare keys with `hmac.compare_digest`; default idempotency key = `to_number` + minute bucket when none supplied. **Step 4:** Run; PASS.
- [ ] **Step 5:** `git status` check; no commit.

### Task 7b: Recommendation client (raw text in, JSON out)

**Files:** `src/recommend.py`, `tests/test_core.py`; `src/agent.py` exposes it.

**Interfaces:** Produces `evaluate_reply(user_id: str, scenario: str, user_text: str, api_url: str | None, http_post) -> dict`. The backend endpoint (not built here) takes the caller's raw words, runs its own Nemotron, and returns suggestion JSON; this client forwards `{user_id, scenario, user_text}` and passes the JSON through unchanged as `{"ok": True, "source": "api", "result": {...}}`. No URL gives `{"ok": True, "source": "stub", "result": None, "note": ...}`; failures give `{"ok": False, "error": str}`. Agent tool `respond_to_caller(caller_words)` wraps it; `user_id` comes from dispatch metadata JSON `{"user_id","scenario"}` set by `POST /calls` (authenticated backend), never from the LLM. Inbound calls default to `demo-user`. Agent Nemotron voices the JSON; it must not invent facts outside it.

- [x] Tests: stub has no fake result; raw text and user binding reach the API; JSON passes through; timeout/bad JSON/empty give error dicts; long text truncated to 1000; `parse_metadata` tolerates garbage.

### Task 7: Agent and LiveKit dialer (SDK-bound code)

**Files:** Create `src/agent.py`, `src/livekit_dialer.py`, `tests/test_agent_tools.py`, `tests/test_livekit_dialer.py`.

**Interfaces:** Consumes Tasks 2, 4, 6. Produces `AGENT_NAME = "nessi-agent"`; `class NessiAgent(Agent)` with `@function_tool` methods `check_connection` and `save_call_note(note: str)` that delegate to `demo_tools` and return its dicts unchanged (so a failure is voiced as failure); `class LiveKitDialer` implementing `Dialer` (dispatch `nessi-agent` to `room_name` via `LiveKitAPI.agent_dispatch.create_dispatch`, then `sip.create_sip_participant` with `sip_trunk_id=settings.outbound_trunk_id`, `participant_identity="phone_user"`, `wait_until_answered=True`).

- [ ] **Step 1:** Failing tests: `test_tool_wrapper_returns_error_dict_on_failure` (point at bad db path; wrapper result has `ok False`); `test_dialer_dispatches_before_sip` (inject fake `LiveKitAPI`; assert call order and the same `room_name` in both requests); `test_dialer_propagates_sip_error`.
- [ ] **Step 2:** Run; FAIL. **Step 3:** Implement. Check installed SDK signatures (`uv run python -c "import livekit.agents; print(livekit.agents.__version__)"`, `lk docs` / the LiveKit docs MCP) before coding; AgentSession pipeline per handoff 4.B5: `nvidia.STT(language_code="en-US")`, `openai.LLM(base_url=NEMOTRON_BASE_URL, model=NEMOTRON_MODEL)` with the NVIDIA key, `nvidia.TTS(voice="Magpie-Multilingual.EN-US.Leo", language_code="en-US")`. Greeting must identify itself as an AI assistant. If the dispatch API needs the room to exist first, create it (handoff 4.E2). **Step 4:** Run; PASS.
- [ ] **Step 5:** `git status` check; no commit. Add `uvicorn` entry in README: `uv run uvicorn src.calls_api:app` needs an `app = create_app(...)` module-level wiring in a thin `src/main.py`.

### Task 8: Agent Console gate (Phase B6)

**Files:** Append to `docs/smoke-test.md`.

- [ ] **Step 1:** Create untracked `.env.local` from the example (user supplies `NVIDIA_API_KEY`, LiveKit keys; never echo them).
- [ ] **Step 2:** `uv run python src/agent.py download-files` if the SDK requires it, then `lk agent dev`; open the Agent Console link.
- [ ] **Step 3:** Hold ~60 s of voice conversation; ask the agent to run `check_connection` and `save_call_note`; confirm the tool log lines and read the note back via `get_call_note`. Verify Nemotron tool calling works; if the model ignores tools, adjust model/prompt and record it.
- [ ] **Step 4:** Mark T03, T04, T05 `VERIFIED` with log excerpts, or record the blocker. **Do not proceed to Task 9 until T03-T05 pass.**

### Task 9: Deploy and inbound call (Phase C)

- [ ] **Step 1:** `lk agent create` (first deploy; later `lk agent deploy`); confirm `nessi-agent` is online in the same project as the trunks.
- [ ] **Step 2:** Edit `SDR_fVNkUWNghqQH`: restrict to `ST_ZgnGygMAx8Gs`, add agent `nessi-agent`. Confirm the rule no longer shows `Agents: —`.
- [ ] **Step 3:** From a separate consenting phone, dial `+15076169071`. Check: rings, AI greeting, two-way speech, interruption, one tool call. Capture LiveKit Calls and Photon Call-activity entries.
- [ ] **Step 4:** Record T02, T06, T11 (inbound half). On failure walk the handoff section 8 table top-down and log the cause.

### Task 10: Outbound via CLI (Phase D)

- [ ] **Step 1:** `lk dispatch create --agent-name nessi-agent --room nessi-out-test-001`.
- [ ] **Step 2:** Create untracked `sip-participant.json` per handoff 4.D2 (trunk `ST_QwVKCdLTwF7b`, consenting number, same room, `wait_until_answered: true`); run `lk sip participant create sip-participant.json`.
- [ ] **Step 3:** Answer on the test phone; confirm conversation and a tool call. Also test decline, no-answer, and busy; record resulting CLI errors for the `CallStatus` mapping.
- [ ] **Step 4:** Record T07 and outbound caller ID shown on the handset.

### Task 11: Outbound via API and hardening (Phases E, G)

**Files:** Create `src/main.py`, `README.md`, `docs/troubleshooting.md`; modify `src/call_state.py`, `src/calls_api.py` only if live tests expose gaps.

- [ ] **Step 1:** Start `uv run uvicorn src.main:app --host 127.0.0.1 --port 8000`; send the authenticated request from handoff 4.E5 (PowerShell: `Invoke-RestMethod` with `x-api-key` header) to a consenting number.
- [ ] **Step 2:** Confirm exactly one call, same room for agent and SIP participant, agent talks, tool verified. Send the same request again with the same key: no second call (T08).
- [ ] **Step 3:** Send requests with no key, wrong key, and a non-allowlisted number; confirm rejection and no ring (T10).
- [ ] **Step 4:** Map observed outcomes to statuses (`busy`, `no_answer`, `failed`, `ended`) via polling `GET /calls/{id}` plus LiveKit SIP participant data; add structured JSON logs (`call_id, room_name, direction, status, error`, no note text). Add max call duration and confirm hangup removes the room/agent (T09).
- [ ] **Step 5:** Write `README.md` (setup from clean machine, no trunk rebuild; T12) and `troubleshooting.md` (copy section 8 table, add findings). Run `uv run pytest -v`; all green.
- [ ] **Step 6:** Update `smoke-test.md` T01-T12 with true statuses. Milestone is done only when T01-T08 and T11 are `VERIFIED`; otherwise list blockers. `git status` check; no commit.

---

## Self-Review

- Spec coverage: Phases A-G, T01-T12, constraints, and non-goals each map to a task (A=1, B=2-4,7,8, C=9, D=10, E=6,11, F=4,8-11, G=5,11). Brev self-hosting deliberately excluded (handoff G5: not a gate).
- Open items I could not resolve from the handoff: exact LiveKit SDK signatures (verify at Task 7 against installed version), Nemotron tool-calling reliability (Task 8 gate), whether `lk agent init` layout differs from `src/` (Task 2 step 1).
- Names checked consistent: `Settings`, `Dialer.dial(room_name, to_number)`, `CallStore.create/update/get/recent_count`, `normalize_e164`, `is_allowed`, `AGENT_NAME`.
