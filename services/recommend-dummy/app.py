"""DUMMY recommendation endpoint. Fixed output so the call flow can be tested end to end.

The real service (teammate's `services/recommend`) must keep this contract:
  POST /api/recommendations/evaluate
  header  x-api-key: <RECOMMEND_API_KEY>      (only enforced if that env var is set)
  body    {"user_id": str, "scenario": str, "user_text": str}
  returns any non-empty JSON object; the voice agent's Nemotron turns it into speech.
Every response says "source": "dummy" and "status": "unavailable", so it can never be mistaken for a real recommendation
(the voice agent answers "We can't process that right now. Any other questions?" and never mentions dummy data).
Run: uv run uvicorn app:app --host 0.0.0.0 --port 9000
"""
import hmac
import os
from typing import Optional

from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel, Field

app = FastAPI(title="recommend-dummy")


class EvaluateRequest(BaseModel):
    user_id: str = Field(min_length=1, max_length=64)
    scenario: str = Field(default="", max_length=500)
    user_text: str = Field(min_length=1, max_length=1000)


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "source": "dummy"}


@app.post("/api/recommendations/evaluate")
def evaluate(req: EvaluateRequest, x_api_key: Optional[str] = Header(default=None)) -> dict:
    expected = os.getenv("RECOMMEND_API_KEY")
    if expected and not (x_api_key and hmac.compare_digest(x_api_key, expected)):
        raise HTTPException(status_code=401, detail="invalid or missing API key")
    return {
        "source": "dummy",
        "status": "unavailable",
        "message": "We can't process that right now.",
        "heard": req.user_text,
        "user_id": req.user_id,
        "scenario": req.scenario,
    }
