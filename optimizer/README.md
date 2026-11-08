# Optimizer

Decides what the user should buy nearby, how to pay, and which offers to use, without breaking a budget. If nothing suitable fits, it says to skip.

It covers spec tasks `OPT-02` to `OPT-09`, from [../spec-checklist.md](../spec-checklist.md).

## Who does what

The rule from spec section 7.1: anything that can be calculated exactly is done by code. Nemotron does only the parts that need judgment about language.

| Step | Done by | Why |
| --- | --- | --- |
| Read the routine and financial-profile files into typed rules | Nemotron, thinking on (6k-token budget), cached | The files are free-form writing |
| Work out what the user is shopping for, when the routine names this place and time | Code | Lookup by place, weekday and time |
| Work out what the user is shopping for, anywhere else | Nemotron, thinking off | Needs a guess from context |
| Decide whether a cheaper item really meets the same need | Nemotron, thinking on (2k budget) | "Is a veggie wrap a lunch? Is a cookie?" |
| Distance, budgets, offer rules, card choice, ranking, skip decision | Code (OR-Tools CP-SAT) | Exact arithmetic and rules |
| One-sentence explanation | Nemotron, thinking off | Plain English |
| Check every dollar figure in the explanation | Code | A wrong number is replaced by a fixed template |

**What makes this Nemotron-specific.** Nemotron can switch step-by-step reasoning ("thinking") on or off per request, and cap how long it thinks (the reasoning budget). One model therefore serves both the slow judgment jobs and the fast phone-notification jobs. The setting for each job is in [`nemotron/jobs.py`](src/optimizer/nemotron/jobs.py).

**How model output is kept honest.** The model gets no tools, so a reply can only ever be data. Every reply is checked against a fixed schema. Every fact must quote its source, and code confirms the quote really appears there. Code parses every dollar amount itself. A rule the model inferred, rather than one the user wrote, is held for the user to confirm and never enforced. If the model calls an item "suitable" without quoting the item's own description, the verdict is downgraded to "unverified".

## Which model

The client works with any OpenAI-compatible endpoint (a server that accepts the same request format as OpenAI's API).

| Hardware | Model | Source |
| --- | --- | --- |
| One H100, H200 or A100 80 GB (e.g. a Brev machine) | `nvidia/NVIDIA-Nemotron-3.5-Lightning-30B-A3B-NVFP4` (default) | Hugging Face model card: "1× H100" |
| Blackwell B200 / B300 | `nvidia/NVIDIA-Nemotron-3-Super-120B-A12B-NVFP4` | Model card minimum: "1× B200" |
| No GPU, with an NVIDIA API key | `nvidia/nemotron-3-super-120b-a12b` on `https://integrate.api.nvidia.com/v1` | NVIDIA API docs |

Settings are environment variables:
- `NEMOTRON_BASE_URL`: the server address. Default is `http://localhost:8000/v1`.
- `NEMOTRON_MODEL`: the model name.
- `NEMOTRON_API_KEY`: the key. Falls back to `NVIDIA_API_KEY`.

## Running

```bash
uv sync
uv run pytest -q
```

On Windows, if this folder's path is long, OR-Tools fails to load with "filename too long". Put the virtual environment at a short path:

```bash
UV_PROJECT_ENVIRONMENT=C:/Users/<you>/.venvs/hackutd-optimizer uv sync
```

To serve the model on Brev, run this on the GPU machine:

```bash
bash serve/brev-vllm.sh
```

Then share port 8000 from the Brev console, and on the laptop:

```bash
export NEMOTRON_BASE_URL=https://<shared-url>/v1 NEMOTRON_MODEL=nvidia/NVIDIA-Nemotron-3.5-Lightning-30B-A3B-NVFP4
uv run pytest -q tests/test_live_nemotron.py
uv run python -m optimizer compile --routine ../profile/initial-routine.md --profile ../profile/financial-profile.md
uv run python -m optimizer recommend --routine ../profile/initial-routine.md --profile ../profile/financial-profile.md \
    --world world.json --lat 32.9857 --lon -96.7502 --source demo
```

`world.json` holds `places`, `items`, `offers`, `payment_methods` and `transactions`. Their fields are defined in [`models.py`](src/optimizer/models.py).

The two files in [`../profile/`](../profile/) are placeholders with no data. Your partner's real files replace them. If they contain no current balance, the optimizer refuses to judge affordability.

## Rules the code enforces

- **Hard limits.** A recommendation must fit three limits:
  - the remaining budget for its category, with budget periods counted in the user's own time zone
  - the money available now
  - the lowest projected balance over the next 30 days, minus the minimum balance the user wants to keep
- **Cashback can't pay for today.** Hard limits are checked against the amount paid now, not the cost after cashback.
- **Ranking order.** Options are ranked by effective cost (amount paid now minus verified cashback). Ties go to better preference fit, then shorter distance, then item ID. This is the spec's proposed starting ranking.
- **Card and offers.** For each item, OR-Tools CP-SAT (a constraint solver that proves its answer is the best possible) picks the card and offers. A property test (a test that generates thousands of random cases) checks CP-SAT against brute force over every combination.
- **Unverified offers** are shown but never counted as savings.
- **Points** without a verified cash value are listed separately, never converted to dollars.
- **Refusals.** The optimizer refuses to recommend, with a reason, when:
  - the location reading is over 10 minutes old
  - the forecast has expired
  - an upcoming expense has no amount estimate
  - it isn't clear what the user is shopping for
- **Skip wording.** If nothing suitable fits, the answer is "skip". If some options couldn't be verified, it says "no affordable alternative was verified" rather than claiming none exist.
- **Expiry.** Each result records a fingerprint (a short hash) of every input, plus an expiry time. `engine.still_valid` reports when a result has gone stale.

## Assumptions the spec does not settle

Revisit these under `DISC-08`:
- Percentage discounts and minimum spend are measured on the list price.
- Percentage cashback is measured on the amount paid after instant discounts.
- A card's own cashback applies on top of merchant offers.
- The comparison baseline is the usual item, at list price, on the default card.
- The search radius defaults to 1 mile when the profile doesn't give one.
- The balance projection in [`forecast.py`](src/optimizer/forecast.py) is a stand-in until the forecast tasks are built (`FORECAST-05`, `FORECAST-06`). It counts uncertain expenses at their upper estimate, and on the same day it applies money out before money in.
