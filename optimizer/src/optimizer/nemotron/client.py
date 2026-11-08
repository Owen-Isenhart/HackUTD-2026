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

    def _call(self, messages: list[dict], schema: type[BaseModel], thinking: Thinking, max_answer_tokens: int):
        extra: dict = {"chat_template_kwargs": {"enable_thinking": thinking.enabled}}
        if thinking.enabled:
            # Honoured by NVIDIA's hosted API; vLLM ignores unknown fields, so
            # the max_tokens cap below is what bounds reasoning there.
            extra["reasoning_budget"] = thinking.budget_tokens
        kwargs = dict(
            model=self.model,
            messages=messages,
            temperature=1.0 if thinking.enabled else 0.2,
            top_p=0.95,
            max_tokens=max_answer_tokens + (thinking.budget_tokens if thinking.enabled else 0),
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
        schema_text = json.dumps(schema.model_json_schema())
        messages = [
            {"role": "system", "content": system + "\n\nReply with one JSON object matching this JSON Schema and nothing else:\n" + schema_text},
            {"role": "user", "content": user},
        ]
        last_error = None
        mode = thinking
        for attempt in range(1, 4):
            resp = self._call(messages, schema, mode, max_answer_tokens)
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
