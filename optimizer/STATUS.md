# Optimizer status

Last updated: 2026-11-07. Owner: Arjun. Branch: `feat/optimizer-nemotron`.

## Working on now

**Connecting to the team's running Nemotron to run the live tests.**
- The team already serves Nemotron 3.5 Bolt E4B on the Brev machine `following-copper-silkworm`. Its served name is `nemotron-bolt`. Don't start a second copy.
- The client now defaults to it: `NEMOTRON_BASE_URL=http://127.0.0.1:8000/v1`, `NEMOTRON_MODEL=nemotron-bolt`. That address works once a port forward is open.
- On Arjun's laptop, WSL (Windows Subsystem for Linux) and the Brev command-line tool are installed, but Brev is not signed in yet. The browser sign-in timed out twice. The next step is Arjun signing in with the token command from https://brev.nvidia.com/settings/cli.
- After that: run `brev port-forward following-copper-silkworm --port 8000:8000`, check the model answers, then run `tests/test_live_nemotron.py`.
- Concern: Bolt is the smallest Nemotron, at about 4B parameters. The two judgment jobs were designed for Lightning (30B) or Super (120B). The live tests will show whether Bolt is good enough.

## Done

The optimizer covers spec tasks `OPT-02` to `OPT-09`. See [README.md](README.md) for the design.

**Decision logic, all plain code with no model calls:**
- distance and search-radius filter
- budgets counted in the user's time zone
- offer rules
- a constraint solver (OR-Tools CP-SAT) that picks the card and offers for each item
- ranking
- the recommend / skip / not-enough-data decision
- expiry of stale results

**Nemotron jobs, each checked by code before use:**
- turning the routine and financial-profile files into rules
- guessing what the user wants when their routine has no match
- judging whether a cheaper item really meets the same need
- writing the notification text

**Other pieces:**
- a stand-in balance projection
- a command-line entry point
- a Brev serve script
- placeholder profile files in [../profile/](../profile/)

**Tests:** 66 pass, using a scripted stand-in for the model. They include a separate brute-force checker (`tests/oracle.py`) that the optimizer must match exactly.

## Not verified yet

- Nothing has been run against a real Nemotron. The live tests in `tests/test_live_nemotron.py` skip themselves until `NEMOTRON_BASE_URL` is set.
- `serve/brev-vllm.sh` has never run on a GPU.

## Waiting on

- The partner's real `initial-routine.md` and `financial-profile.md`. Drop them into `profile/` to replace the placeholders.
- Access to Nemotron: either the Brev route above, or an NVIDIA API key.

## Open questions for the team

- The spec leaves the choices below open. The current answers are listed in [README.md](README.md) under "Assumptions the spec does not settle".
  - Is a percentage discount measured on the list price, or on the price after other discounts?
  - What is the comparison baseline for "savings"?
  - What should the default search radius be?
- `context.md` says not to commit or push. Arjun has asked for progress to be pushed so the team can follow it. That line in `context.md` may need updating.
