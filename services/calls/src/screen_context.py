"""Tell the voice agent which app screen the user is on.

The app publishes LiveKit participant attributes (`page`, `visible`, `facts`).
They are untrusted client text, so the rendered context is bounded and single-line.
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
import unicodedata
from collections.abc import Callable
from typing import Any

from src.navigation import ROUTES

logger = logging.getLogger("nessi.agent")

SCREEN_CONTEXT_ID = "screen-context"
MAX_LABEL = 40
MAX_FACT = 160   # characters per fact
MAX_FACTS = 24   # facts per tab: enough for a judge's varied questions, small enough to stay cheap
MAX_ITEMS = 8    # visible section labels
MAX_ATTRIBUTE = 8192
_EVENT = "participant_attributes_changed"


def _clean(value: str) -> str:
    # Whitespace controls (newline, tab) become spaces so words don't fuse.
    spaced = "".join(" " if ch.isspace() else ch for ch in value)
    kept = "".join(ch for ch in spaced if not unicodedata.category(ch).startswith("C"))
    return re.sub(r"\s+", " ", kept).strip()


def _read_lines(raw: Any, max_length: int, max_items: int = MAX_ITEMS) -> list[str]:
    labels: list[str] = []
    if isinstance(raw, str) and len(raw) <= MAX_ATTRIBUTE:
        try:
            parsed = json.loads(raw)
        except (ValueError, RecursionError):
            parsed = None
        if isinstance(parsed, list):
            for item in parsed:
                if not isinstance(item, str):
                    continue
                label = _clean(item)[:max_length].strip()
                if label:
                    labels.append(label)
                if len(labels) >= max_items:
                    break
    return labels


def format_screen_context(attrs: dict) -> str:
    page = attrs.get("page") if isinstance(attrs, dict) else None
    if not isinstance(page, str):
        return ""
    title = _clean(page.replace("-", " ").replace("_", " ")).title()[:MAX_LABEL].strip()
    if not title:
        return ""

    context = f"Page: {title}."
    labels = _read_lines(attrs.get("visible"), MAX_LABEL)
    if labels:
        context += f" Visible: {', '.join(labels)}."
    facts = _read_lines(attrs.get("facts"), MAX_FACT, MAX_FACTS) if page in ROUTES else []
    if facts:
        context += " Tab facts: " + json.dumps(facts, ensure_ascii=False)
    return context


async def apply_screen_context(agent: Any, text: str) -> None:
    logger.info("screen context applied chars=%d", len(text))
    new_ctx = agent.chat_ctx.copy()
    new_ctx.items[:] = [i for i in new_ctx.items if i.id != SCREEN_CONTEXT_ID]
    if text:
        new_ctx.add_message(role="system", content=f"Scenario: {text}", id=SCREEN_CONTEXT_ID)
    await agent.update_chat_ctx(new_ctx)


def attach_screen_context(room: Any, agent: Any, app_identity: str) -> Callable[[], None]:
    tasks: set[asyncio.Task] = set()
    update_lock = asyncio.Lock()

    async def update(text: str) -> None:
        async with update_lock:
            await apply_screen_context(agent, text)

    def _done(task: asyncio.Task) -> None:
        tasks.discard(task)
        if not task.cancelled() and task.exception() is not None:
            logger.error("screen context update failed", exc_info=task.exception())

    def handler(changed_attributes: dict, participant: Any) -> None:
        if getattr(participant, "identity", None) != app_identity:
            return
        try:
            text = format_screen_context(dict(participant.attributes))
            task = asyncio.get_running_loop().create_task(update(text))
        except Exception:
            logger.exception("screen context handler failed")
            return
        tasks.add(task)
        task.add_done_callback(_done)

    room.on(_EVENT, handler)

    def detach() -> None:
        room.off(_EVENT, handler)
        for task in tasks:
            task.cancel()

    return detach
