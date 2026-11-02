"""Device protocol helpers: parsing inbound JSON lines and validating outbound commands."""

from __future__ import annotations

import json
import re
from typing import Any

# Commands the ground station is allowed to send to the device.
_COMMAND_RE = re.compile(r"^(START|STOP|RESET|PING|REFILL|OVERRIDE (ON|OFF)|SET_FLOW \d{1,3}(\.\d{1,3})?)$")

MAX_ECHO_CHARS = 200


def normalize_command(raw: str) -> str | None:
    """Uppercase, collapse whitespace and validate. Returns None if not allowed."""
    cmd = " ".join(str(raw).strip().upper().split())
    return cmd if _COMMAND_RE.match(cmd) else None


def parse_line(raw: bytes) -> tuple[dict[str, Any] | None, str | None, str]:
    """Parse one newline-delimited line from the device.

    Returns (message, error, text). Exactly one of message/error is set for
    non-empty lines; both are None for blank lines.
    """
    text = raw.decode("utf-8", errors="replace").strip()
    if not text:
        return None, None, text
    try:
        obj = json.loads(text)
    except json.JSONDecodeError as exc:
        return None, f"invalid JSON ({exc.msg})", text
    if not isinstance(obj, dict) or not isinstance(obj.get("type"), str):
        return None, "missing 'type' field", text
    return obj, None, text
