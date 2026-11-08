"""Tap-to-talk for Expo Go, which cannot load LiveKit's native WebRTC.

One HTTP turn: the phone records a short WAV with expo-audio and posts it here.
We transcribe it with NVIDIA Parakeet (hosted Riva), answer with Nemotron from
the signed-in user's live finance summary (Nessie v2 + Tiger Data, fetched with
their own finance session token), and speak the answer with Magpie (Mia, the
same voice as the LiveKit in-app profile). The app plays the WAV and shows the
text in Nessie's speech bubble.
"""
from __future__ import annotations

import hashlib
import io
import json
import logging
import re
import time
import wave
from pathlib import Path
from typing import Optional

import httpx
import riva.client

from src.navigation import ROUTES, match_destination

log = logging.getLogger("nessi.expo_voice")

RIVA_SERVER = "grpc.nvcf.nvidia.com:443"
ASR_FUNCTION_ID = "1598d209-5e27-4d3c-8079-4751568b1081"  # parakeet-1.1b en-US (same as the LiveKit plugin)
ASR_MODEL = "parakeet-1.1b-en-US-asr-streaming-silero-vad-sortformer"
TTS_FUNCTION_ID = "877104f7-e885-42b9-8de8-f6e4c6303969"  # magpie-tts-multilingual
TTS_RATE = 16000  # smaller replies over a phone connection; plenty for speech
MAX_AUDIO_BYTES = 4_000_000  # about two minutes of 16 kHz mono PCM
PROMPT_PATH = Path(__file__).resolve().parent.parent / "prompts" / "app_voice.txt"
PAGES = {"deals": "Nearby Deals", "spending": "Current Spending", "upcoming": "Upcoming Cashflow", "account": "Account"}


def _auth(api_key: str, function_id: str) -> riva.client.Auth:
    return riva.client.Auth(uri=RIVA_SERVER, use_ssl=True,
                            metadata_args=[["authorization", f"Bearer {api_key}"], ["function-id", function_id]])


def read_wav(data: bytes) -> tuple[bytes, int]:
    """PCM16 mono frames and sample rate from a WAV file; raises ValueError otherwise."""
    with wave.open(io.BytesIO(data)) as w:
        if w.getsampwidth() != 2:
            raise ValueError("expected 16-bit PCM")
        frames = w.readframes(w.getnframes())
        if w.getnchannels() == 2:  # keep the left channel
            frames = b"".join(frames[i:i + 2] for i in range(0, len(frames), 4))
        elif w.getnchannels() != 1:
            raise ValueError("expected mono or stereo audio")
        return frames, w.getframerate()


def to_wav(pcm: bytes, rate: int) -> bytes:
    out = io.BytesIO()
    with wave.open(out, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(pcm)
    return out.getvalue()


def transcribe(pcm: bytes, rate: int, api_key: str) -> str:
    asr = riva.client.ASRService(_auth(api_key, ASR_FUNCTION_ID))
    config = riva.client.StreamingRecognitionConfig(
        config=riva.client.RecognitionConfig(
            encoding=riva.client.AudioEncoding.LINEAR_PCM, language_code="en-US", model=ASR_MODEL,
            max_alternatives=1, enable_automatic_punctuation=True, sample_rate_hertz=rate, audio_channel_count=1),
        interim_results=False)
    chunk = rate // 5 * 2  # 200 ms of 16-bit audio
    parts = []
    for resp in asr.streaming_response_generator(audio_chunks=(pcm[i:i + chunk] for i in range(0, len(pcm), chunk)),
                                                 streaming_config=config):
        for result in resp.results:
            if result.is_final and result.alternatives:
                parts.append(result.alternatives[0].transcript.strip())
    return " ".join(p for p in parts if p).strip()


def synthesize(text: str, api_key: str, voice: str) -> bytes:
    tts = riva.client.SpeechSynthesisService(_auth(api_key, TTS_FUNCTION_ID))
    resp = tts.synthesize(text, voice_name=voice, language_code="en-US",
                          encoding=riva.client.AudioEncoding.LINEAR_PCM, sample_rate_hz=TTS_RATE)
    return to_wav(resp.audio, TTS_RATE)


def _money(n) -> str:
    return f"${n:,.2f}" if isinstance(n, (int, float)) else str(n)


def knowledge_from_summary(s: dict) -> str:
    """Plain-text facts from GET /api/v1/app/summary; the only data Nessie may use."""
    a, sp, up = s.get("account", {}), s.get("spending", {}), s.get("upcoming", {})
    lines = [f"Name: {a.get('name')}. Checking ({a.get('checking')}): {a.get('balance')} available."]
    for l in a.get("linked", []):
        lines.append(f"{l.get('name')} ({l.get('sub')}): {l.get('amt')} {l.get('badge', '').lower()}.")
    lines.append(f"Spending in {sp.get('monthLabel')}: {_money(sp.get('total'))} so far, daily average {_money(sp.get('dailyAverage'))}."
                 + (f" That is {abs(sp['changePct'])}% {'less' if sp['changePct'] <= 0 else 'more'} than {sp.get('prevMonthLabel')} at this point."
                    if sp.get("changePct") is not None else "") + f" Status: {sp.get('status')}. {sp.get('budgetLine', '')}")
    if sp.get("categories"):
        lines.append("By category: " + "; ".join(f"{c['short']} {_money(c['amt'])} ({c['pct']}%)" for c in sp["categories"]) + ".")
    for b in sp.get("budgets", []):
        lines.append(f"Budget {b['category']}: {_money(b['spent'])} spent of {_money(b['limit'])} this month.")
    if sp.get("transactions"):
        lines.append("Latest purchases: " + "; ".join(f"{t['name']} {_money(abs(t['amt']))} ({t['when']})" for t in sp["transactions"]) + ".")
    for b in up.get("bills", []):
        lines.append(f"Bill: {b['name']} {_money(b['amt'])}, {b['line']}, {b['tag']}.")
    for i in up.get("incomes", []):
        lines.append(f"Expected income: {i['name']} from {i['line']} {_money(i['amt'])} on {i['date']} ({i['status'].lower()}).")
    if up.get("safeToSpend") is not None:
        lines.append(f"Safe to spend after all bills in the next 30 days: {_money(up['safeToSpend'])}.")
    for d in s.get("deals", [])[:6]:
        lines.append(f"Card perk: {d['merchant']} {d['reward']} with SavorOne ({d['dist']}).")
    rec = s.get("recommendation")
    if rec:
        lines.append(f"Top recommendation: {rec['title']}. {rec['text']}")
    return "\n".join(lines)


_summaries: dict = {}
SUMMARY_TTL_S = 60.0


def fetch_summary(finance_url: str, token: str) -> Optional[dict]:
    """The user's live summary, cached for a minute per session so back-to-back turns stay fast."""
    if not finance_url or not token:
        return None
    key = hashlib.sha256(token.encode()).hexdigest()
    hit = _summaries.get(key)
    if hit and time.monotonic() - hit[0] < SUMMARY_TTL_S:
        return hit[1]
    try:
        r = httpx.get(finance_url.rstrip("/") + "/api/v1/app/summary",
                      headers={"Authorization": f"Bearer {token}"}, timeout=15)
    except httpx.HTTPError:
        return None
    if r.status_code != 200:
        _summaries.pop(key, None)
        return None
    _summaries[key] = (time.monotonic(), r.json())
    return _summaries[key][1]


def spoken(text: str, max_words: int = 30) -> str:
    """At most two sentences and about 30 words, as the app prompt asks."""
    sentences = re.split(r"(?<=[.!?])\s+", text.strip())
    out = " ".join(sentences[:2])
    words = out.split()
    if len(words) > max_words:
        out = " ".join(words[:max_words]).rstrip(",;:") + "."
    return out


def system_prompt(knowledge: Optional[str], tab: Optional[str]) -> str:
    base = PROMPT_PATH.read_text(encoding="utf-8")
    page = PAGES.get(tab or "", "")
    return (base
            + "\n\nNAVIGATION\nThere is no navigate_app tool. To open a page, set \"navigate\" to one of: deals, spending, upcoming, account, and say \"Opening <page name>.\" Otherwise set it to null."
            + "\n\nOUTPUT\nReturn only JSON: {\"reply\": \"<what you say>\", \"navigate\": null or one of the four pages}."
            + (f"\n\nSCREEN CONTEXT\nScenario: Page: {page}." if page else "")
            + "\n\nKNOWLEDGE\n" + (knowledge or "No account data is available right now."))


def answer(text: str, tab: Optional[str], knowledge: Optional[str], *, base_url: str, model: str, api_key: str) -> tuple[str, Optional[str]]:
    direct = match_destination(text)
    if not direct:
        m = re.match(r"^(?:please )?(?:open|go to|show me|show|take me to|navigate to|switch to)(?: the| my)? ([a-z ]+?)(?: page| screen| tab)?[.!?]?$",
                     re.sub(r"\s+", " ", text.lower()).strip())
        direct = ALIASES.get(m.group(1)) if m else None
    if direct:
        return f"Opening {PAGES[direct]}.", direct
    r = httpx.post(base_url.rstrip("/") + "/chat/completions", timeout=20,
                   headers={"Authorization": f"Bearer {api_key}"},
                   json={"model": model, "temperature": 0.2, "max_tokens": 200,
                         "chat_template_kwargs": {"enable_thinking": False},
                         "messages": [{"role": "system", "content": system_prompt(knowledge, tab)},
                                      {"role": "user", "content": text}]})
    r.raise_for_status()
    content = r.json()["choices"][0]["message"]["content"] or ""
    m = re.search(r"\{.*\}", content, re.S)
    try:
        parsed = json.loads(m.group(0)) if m else {}
    except json.JSONDecodeError:
        parsed = {}
    reply = spoken(str(parsed.get("reply") or re.sub(r"[{}\"]", "", content)))
    nav = str(parsed.get("navigate") or "").strip().lower()
    nav = ALIASES.get(nav, nav)
    if nav in ROUTES:
        return f"Opening {PAGES[nav]}.", nav
    return reply or "Sorry, I didn't catch that.", None


# Page names people (and the model) use for the four tabs.
ALIASES = {"current spending": "spending", "budget": "spending", "budgets": "spending", "upcoming cashflow": "upcoming",
           "bills": "upcoming", "upcoming bills": "upcoming", "nearby deals": "deals", "deal": "deals", "offers": "deals",
           "map": "deals", "profile": "account", "my account": "account"}
