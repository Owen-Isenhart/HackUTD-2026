# Optimizer status

Last updated: 2026-11-07. Owner: Arjun. Branch: `feat/optimizer-nemotron`.

## Working on now

**Getting a live Nemotron to test against.**
- The plan is to serve Nemotron on the team's Brev GPU machine (`following-copper-silkworm`) and reach it from Arjun's laptop.
- Brev's command-line tool has no Windows version, so it has to run inside WSL (Windows Subsystem for Linux).
- WSL is installed but hangs, most likely until Windows is restarted.
- Fallback if Brev stays blocked: NVIDIA's hosted API with an `NVIDIA_API_KEY`.

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

**Tests:** 50 pass, using a scripted stand-in for the model.

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
