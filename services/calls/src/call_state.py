"""In-memory call records with idempotency. Ephemeral by design (demo)."""
import threading
import time
import uuid
from dataclasses import dataclass, field
from enum import Enum
from typing import Optional


class CallStatus(str, Enum):
    dial_requested = "dial_requested"
    ringing = "ringing"
    answered = "answered"
    ended = "ended"
    busy = "busy"
    no_answer = "no_answer"
    declined = "declined"
    failed = "failed"
    canceled = "canceled"


TERMINAL = {CallStatus.ended, CallStatus.busy, CallStatus.no_answer, CallStatus.declined, CallStatus.failed, CallStatus.canceled}


@dataclass
class CallRecord:
    call_id: str
    room_name: str
    to_number: str
    status: CallStatus
    idempotency_key: str
    created_at: float = field(default_factory=time.time)
    scenario: Optional[str] = None
    decision: Optional[str] = None  # "accepted" | "declined"
    user_id: str = "demo-user"


class CallStore:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._by_id = {}
        self._by_key = {}

    def create(self, idempotency_key: str, to_number: str, room_name: str,
               scenario: Optional[str] = None, *, call_id: Optional[str] = None,
               user_id: str = "demo-user"):
        with self._lock:
            existing = self._by_key.get(idempotency_key)
            if existing:
                record = self._by_id[existing]
                if call_id and (record.call_id, record.user_id, record.to_number) != (call_id, user_id, to_number):
                    raise ValueError("call identity conflicts with previous request")
                return record, False
            if call_id and call_id in self._by_id:
                raise ValueError("call ID already exists")
            rec = CallRecord(call_id or uuid.uuid4().hex, room_name, to_number,
                             CallStatus.dial_requested, idempotency_key, scenario=scenario, user_id=user_id)
            self._by_id[rec.call_id] = rec
            self._by_key[idempotency_key] = rec.call_id
            return rec, True

    def update(self, call_id: str, status: CallStatus) -> CallRecord:
        with self._lock:
            rec = self._by_id[call_id]
            if rec.status in TERMINAL:
                raise ValueError(f"call {call_id} already {rec.status.value}")
            rec.status = status
            return rec

    def set_decision(self, call_id: str, decision: str) -> CallRecord:
        with self._lock:
            rec = self._by_id[call_id]
            rec.decision = decision
            return rec

    def has_key(self, idempotency_key: str) -> bool:
        with self._lock:
            return idempotency_key in self._by_key

    def get(self, call_id: str) -> Optional[CallRecord]:
        with self._lock:
            return self._by_id.get(call_id)

    def get_by_room(self, room_name: str) -> Optional[CallRecord]:
        with self._lock:
            return next((r for r in self._by_id.values() if r.room_name == room_name), None)

    def recent_count(self, to_number: str, window_s: int) -> int:
        cutoff = time.time() - window_s
        with self._lock:
            return sum(1 for r in self._by_id.values()
                       if r.to_number == to_number and r.created_at >= cutoff
                       and r.status != CallStatus.failed)  # a dial that never rang is not spam
