"""Private HTTP adapter for typed, deterministic optimizer inputs."""

import hmac
import json
import os
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from pydantic import Field, ValidationError

from .engine import Inputs, OptimizerConfig, optimize
from .models import (
    ConstraintSet, ForecastSnapshot, Frozen, Item, LocationFix, Offer, PaymentMethod,
    Place, PurchaseIntent, SuitabilityJudgement, Transaction,
)


class EvaluationRequest(Frozen):
    constraints: ConstraintSet
    forecast: ForecastSnapshot
    fix: LocationFix
    places: list[Place] = Field(max_length=100)
    items: list[Item] = Field(max_length=100)
    offers: list[Offer] = Field(max_length=100)
    payment_methods: list[PaymentMethod] = Field(max_length=16)
    transactions: list[Transaction] = Field(max_length=4000)
    intent: PurchaseIntent
    judgements: list[SuitabilityJudgement] = Field(max_length=100)

    def inputs(self) -> Inputs:
        return Inputs(self.constraints, self.forecast, self.fix, self.places, self.items, self.offers,
                      self.payment_methods, self.transactions, self.intent, self.judgements)


def handler(api_key: str):
    class Handler(BaseHTTPRequestHandler):
        def setup(self):
            self.request.settimeout(5)
            super().setup()

        def log_message(self, *_):
            pass  # The caller logs a sanitized result code.

        def reply(self, status: int, body: dict):
            encoded = json.dumps(body).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(encoded)))
            self.end_headers()
            self.wfile.write(encoded)

        def do_GET(self):
            if self.path == "/health":
                self.reply(200, {"status": "ok"})
            else:
                self.reply(404, {"error": "not_found"})

        def do_POST(self):
            if self.path != "/internal/v1/optimizer/evaluate":
                self.reply(404, {"error": "not_found"})
                return
            if not hmac.compare_digest(self.headers.get("x-api-key", "").encode(), api_key.encode()):
                self.reply(401, {"error": "invalid_credentials"})
                return
            try:
                length = int(self.headers.get("Content-Length", "0"))
                if not 0 < length <= 512_000:
                    self.reply(413, {"error": "invalid_body_size"})
                    return
                request = EvaluationRequest.model_validate_json(self.rfile.read(length))
                config = OptimizerConfig(max_fix_age=timedelta(seconds=20), location_ttl=timedelta(seconds=20),
                                         solver_time_limit_s=1.0)
                decision = optimize(request.inputs(), datetime.now(timezone.utc), config)
            except (ValidationError, ValueError, TimeoutError):
                self.reply(400, {"error": "invalid_optimizer_input"})
                return
            self.reply(200, decision.model_dump(mode="json"))

    return Handler


if __name__ == "__main__":
    key = os.getenv("OPTIMIZER_API_KEY", "")
    if len(key) < 24:
        raise SystemExit("Set OPTIMIZER_API_KEY to a separate random value of at least 24 characters.")
    with ThreadingHTTPServer(("127.0.0.1", int(os.getenv("OPTIMIZER_PORT", "8789"))), handler(key)) as server:
        server.serve_forever()
