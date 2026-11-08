"""Harmless demo tools. SQLite is per-instance demo state, not durable user memory."""
import sqlite3
from typing import Optional

MAX_NOTE = 500


def check_connection() -> dict:
    return {"ok": True, "service": "nessi-calls"}


def _connect(db_path: str) -> sqlite3.Connection:
    conn = sqlite3.connect(db_path)
    conn.execute(
        "CREATE TABLE IF NOT EXISTS notes (id INTEGER PRIMARY KEY AUTOINCREMENT, call_id TEXT, note TEXT)"
    )
    return conn


def get_call_note(db_path: str, note_id: int) -> Optional[str]:
    conn = _connect(db_path)
    try:
        row = conn.execute("SELECT note FROM notes WHERE id = ?", (note_id,)).fetchone()
        return row[0] if row else None
    finally:
        conn.close()


def save_call_note(db_path: str, call_id: str, note: str) -> dict:
    note = (note or "").strip()
    if not note:
        return {"ok": False, "error": "note is empty"}
    if len(note) > MAX_NOTE:
        return {"ok": False, "error": f"note exceeds {MAX_NOTE} characters"}
    try:
        conn = _connect(db_path)
        try:
            cur = conn.execute("INSERT INTO notes (call_id, note) VALUES (?, ?)", (call_id, note))
            conn.commit()
            note_id = cur.lastrowid
        finally:
            conn.close()
        stored = get_call_note(db_path, note_id)
    except (sqlite3.Error, OSError) as e:
        return {"ok": False, "error": f"could not save note: {e}"}
    if stored != note:
        return {"ok": False, "error": "read-back mismatch"}
    return {"ok": True, "note_id": note_id, "note": stored}
