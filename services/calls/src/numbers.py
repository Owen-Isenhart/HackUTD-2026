"""E.164 normalization and allowlist checks."""
import re

OWN_NUMBER = "+15076169071"  # Photon line; dialing it loops into our own inbound route


def normalize_e164(raw: str, default_region_code: str = "1") -> str:
    if not isinstance(raw, str) or not raw.strip():
        raise ValueError("empty phone number")
    s = raw.strip()
    if not re.fullmatch(r"\+?[\d\s().-]+", s):
        raise ValueError(f"invalid phone number: {raw!r}")
    digits = re.sub(r"\D", "", s)
    if s.startswith("+"):
        full = digits
    elif default_region_code == "1" and len(digits) == 10:
        full = "1" + digits
    elif default_region_code == "1" and len(digits) == 11 and digits.startswith("1"):
        full = digits
    else:
        full = default_region_code + digits
    if full.startswith("1") and len(full) != 11:
        raise ValueError(f"invalid NANP number: {raw!r}")
    if not 8 <= len(full) <= 15:
        raise ValueError(f"invalid phone number length: {raw!r}")
    return "+" + full


def is_allowed(number: str, allowed: frozenset) -> bool:
    try:
        n = normalize_e164(number)
    except ValueError:
        return False
    return n != OWN_NUMBER and n in allowed
