"""Nemotron client: one OpenAI-compatible endpoint, typed replies only.

Works against a self-hosted vLLM server (e.g. on Brev) or NVIDIA's hosted API
(integrate.api.nvidia.com). Configuration comes from environment variables:

    NEMOTRON_BASE_URL   default http://127.0.0.1:8000/v1 (team Brev VM via brev port-forward)
    NEMOTRON_MODEL      default nemotron-bolt (served name of nvidia/NVIDIA-Nemotron-3.5-Bolt-E4B-BF16)
    NEMOTRON_API_KEY    falls back to NVIDIA_API_KEY, then "EMPTY" (vLLM)

Nemotron's distinctive control used here is per-request reasoning: the same
model thinks step by step for slow, judgement-heavy jobs and answers directly
for fast ones. `Thinking` describes that per call.

Every reply is parsed into a Pydantic model. The server is asked to constrain
output to the JSON schema (vLLM structured outputs); if it refuses, the schema
goes in the prompt instead. Either way the reply is validated, and one retry is
made with the validation error shown to the model. Nemotron never receives
tools, so a reply can only ever be data.
"""

from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass
from typing import Protocol, TypeVar

from pydantic import BaseModel, ValidationError

T = TypeVar("T", bound=BaseModel)

DEFAULT_MODEL = "nemotron-bolt"


@dataclass(frozen=True)
class Thinking:
    enabled: bool
    budget_tokens: int = 0  # reasoning cap when enabled

    @classmethod
    def off(cls) -> Thinking:
        return cls(False)

    @classmethod
    def on(cls, budget_tokens: int) -> Thinking:
        return cls(True, budget_tokens)


@dataclass(frozen=True)
class Reply:
    data: BaseModel
    reasoning: str | None  # kept for audit/provenance, never parsed for facts
    attempts: int
    thinking_used: bool


class NemotronError(RuntimeError):
    pass


class LLM(Protocol):
    def structured(self, system: str, user: str, schema: type[T], thinking: Thinking, max_answer_tokens: int = 2048) -> Reply: ...


def thinking_allowed(model: str, setting: str | None) -> bool:
    """Whether jobs may turn step-by-step reasoning on.

    NEMOTRON_THINKING=on|off decides. Unset, it is off for Bolt: measured on the
    team box (2026-11-08, nemotron-bolt, 5-item suitability judge, 2 runs each)
    thinking on took ~20 s and hedged with "unverified" on clear non-lunches,
    while thinking off took 4.7 s and judged all five correctly. Larger models
    keep it on until measured.
    """
    if setting:
        if setting.strip().lower() not in ("on", "off"):
            raise ValueError(f"NEMOTRON_THINKING must be 'on' or 'off', not {setting!r}")
        return setting.strip().lower() == "on"
    return "bolt" not in model.lower()


MIN_THINKING_TOKENS = 256
_SAFETY_TOKENS = 64


def fit_tokens(context_limit: int | None, prompt_chars: int, answer_tokens: int, thinking: Thinking) -> tuple[int, Thinking]:
    """Split the model's context between prompt, thinking and answer.

    `context_limit` is the server's total token limit (vLLM reports it as
    max_model_len; Bolt on the team box has 8192). The prompt size is estimated
    at 3 characters per token, which overestimates for English and JSON, so the
    request stays under the limit. The answer gets its full allowance if it
    fits; thinking gets what is left, up to its budget, and is switched off if
    fewer than MIN_THINKING_TOKENS remain. Returns (max_tokens, thinking used).
    """
    if context_limit is None:
        return answer_tokens + (thinking.budget_tokens if thinking.enabled else 0), thinking
    room = context_limit - prompt_chars // 3 - _SAFETY_TOKENS
    if room < 64:
        raise NemotronError(f"prompt of ~{prompt_chars // 3} tokens leaves no room in a {context_limit}-token context")
    answer = min(answer_tokens, room)
    if thinking.enabled:
        think = min(thinking.budget_tokens, room - answer)
        if think >= MIN_THINKING_TOKENS:
            return answer + think, Thinking.on(think)
    return answer, Thinking.off()


def _strip_to_json(text: str) -> str:
    text = re.sub(r"<think>.*?</think>", "", text, flags=re.S).strip()
    fence = re.search(r"```(?:json)?\s*(.*?)```", text, flags=re.S)
    if fence:
        return fence.group(1).strip()
    start = min((i for i in (text.find("{"), text.find("[")) if i >= 0), default=-1)
    return text[start:] if start >= 0 else text


class NemotronClient:
    def __init__(self, base_url: str | None = None, model: str | None = None, api_key: str | None = None, timeout_s: float = 120.0):
        from openai import OpenAI

        self.model = model or os.environ.get("NEMOTRON_MODEL", DEFAULT_MODEL)
        self._client = OpenAI(
            base_url=base_url or os.environ.get("NEMOTRON_BASE_URL", "http://127.0.0.1:8000/v1"),
            api_key=api_key or os.environ.get("NEMOTRON_API_KEY") or os.environ.get("NVIDIA_API_KEY") or "EMPTY",
            timeout=timeout_s,
            max_retries=2,
        )
        self._schema_mode = True  # flips off if the server rejects response_format
        self._context_limit: int | None | bool = False  # False: not looked up yet
        self.thinking_allowed = thinking_allowed(self.model, os.environ.get("NEMOTRON_THINKING"))
        self._last_thinking: Thinking | None = None  # what the last request actually used

    def context_limit(self) -> int | None:
        """The server's total token limit for this model, if it reports one.
        vLLM lists it as max_model_len on /v1/models; NVIDIA's hosted API does not."""
        if self._context_limit is False:
            limit = None
            try:
                for m in self._client.models.list().data:
                    if m.id == self.model:
                        raw = (m.model_extra or {}).get("max_model_len")
                        limit = int(raw) if raw else None
            except Exception:
                limit = None
            self._context_limit = limit
        return self._context_limit  # type: ignore[return-value]

    def _call(self, messages: list[dict], schema: type[BaseModel], thinking: Thinking, max_answer_tokens: int):
        if not self.thinking_allowed:
            thinking = Thinking.off()
        prompt_chars = sum(len(m["content"]) for m in messages)
        if self._schema_mode:
            prompt_chars += len(json.dumps(schema.model_json_schema(), separators=(",", ":")))
        max_tokens, thinking = fit_tokens(self.context_limit(), prompt_chars, max_answer_tokens, thinking)
        self._last_thinking = thinking
        extra: dict = {"chat_template_kwargs": {"enable_thinking": thinking.enabled}}
        if thinking.enabled:
            # Honoured by NVIDIA's hosted API; vLLM ignores unknown fields, so
            # the max_tokens cap is what bounds reasoning there.
            extra["reasoning_budget"] = thinking.budget_tokens
        kwargs = dict(
            model=self.model,
            messages=messages,
            temperature=1.0 if thinking.enabled else 0.2,
            top_p=0.95,
            max_tokens=max_tokens,
            extra_body=extra,
        )
        if self._schema_mode:
            kwargs["response_format"] = {
                "type": "json_schema",
                "json_schema": {"name": schema.__name__, "schema": schema.model_json_schema(), "strict": True},
            }
        from openai import BadRequestError

        try:
            return self._client.chat.completions.create(**kwargs)
        except BadRequestError as e:
            if self._schema_mode and "response_format" in str(e).lower():
                self._schema_mode = False
                kwargs.pop("response_format")
                return self._client.chat.completions.create(**kwargs)
            raise

    def structured(self, system: str, user: str, schema: type[T], thinking: Thinking, max_answer_tokens: int = 2048) -> Reply:
        schema_text = json.dumps(schema.model_json_schema(), separators=(",", ":"))
        messages = [
            {"role": "system", "content": system + "\n\nReply with one JSON object matching this JSON Schema and nothing else:\n" + schema_text},
            {"role": "user", "content": user},
        ]
        last_error = None
        mode = thinking if self.thinking_allowed else Thinking.off()
        for attempt in range(1, 4):
            self._last_thinking = None
            resp = self._call(messages, schema, mode, max_answer_tokens)
            if self._last_thinking is not None:
                mode = self._last_thinking  # report what was actually sent
            choice = resp.choices[0]
            content = choice.message.content or ""
            reasoning = getattr(choice.message, "reasoning_content", None) or getattr(choice.message, "reasoning", None)
            if choice.finish_reason == "length" and mode.enabled and not content.strip():
                # Reasoning ran past its budget. Answer directly instead.
                mode = Thinking.off()
                continue
            try:
                data = schema.model_validate_json(_strip_to_json(content))
                return Reply(data=data, reasoning=reasoning, attempts=attempt, thinking_used=mode.enabled)
            except ValidationError as e:
                last_error = e
                messages = messages + [
                    {"role": "assistant", "content": content},
                    {"role": "user", "content": f"That reply was invalid: {e.errors(include_url=False)}. Reply again with valid JSON only."},
                ]
        raise NemotronError(f"no valid {schema.__name__} after retries: {last_error}")
