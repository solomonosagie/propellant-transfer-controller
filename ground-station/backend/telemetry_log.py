"""CSV telemetry logger. One timestamped file per logging session."""

from __future__ import annotations

import csv
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, TextIO

FIELDS = [
    "host_time_utc",
    "host_ms",
    "device_t_ms",
    "seq",
    "state",
    "pressure_kpa",
    "tank_a_pct",
    "tank_b_pct",
    "valve",
    "flow_pct_s",
    "flow_set_pct_s",
    "flow_mode",
    "temp_c",
    "fault",
    "uptime_s",
]


class TelemetryLogger:
    def __init__(self, directory: Path, enabled: bool = True) -> None:
        self.directory = directory
        self.enabled = enabled
        self.file: Path | None = None
        self.rows = 0
        self._fh: TextIO | None = None
        self._writer: Any = None

    def set_enabled(self, enabled: bool) -> None:
        if enabled == self.enabled:
            return
        self.enabled = enabled
        if not enabled:
            self.close()

    def log(self, msg: dict[str, Any]) -> None:
        if not self.enabled:
            return
        if self._fh is None:
            self._open()
        rx_ms = msg.get("rx", 0)
        self._writer.writerow(
            [
                datetime.fromtimestamp(rx_ms / 1000, tz=timezone.utc).isoformat(timespec="milliseconds"),
                int(rx_ms),
                msg.get("t", ""),
                msg.get("seq", ""),
                msg.get("state", ""),
                msg.get("pressure", ""),
                msg.get("tankA", ""),
                msg.get("tankB", ""),
                msg.get("valve", ""),
                msg.get("flow", ""),
                msg.get("flowSet", ""),
                msg.get("flowMode", ""),
                msg.get("temp", ""),
                msg.get("fault") or "",
                msg.get("uptime", ""),
            ]
        )
        self.rows += 1

    def close(self) -> None:
        if self._fh is not None:
            self._fh.close()
        self._fh = None
        self._writer = None

    def list_files(self) -> list[dict[str, Any]]:
        if not self.directory.exists():
            return []
        files = sorted(self.directory.glob("*.csv"), key=lambda p: p.stat().st_mtime, reverse=True)
        return [
            {
                "name": p.name,
                "size": p.stat().st_size,
                "modified": int(p.stat().st_mtime * 1000),
                "active": self.file is not None and p.resolve() == self.file.resolve() and self._fh is not None,
            }
            for p in files
        ]

    def _open(self) -> None:
        self.directory.mkdir(parents=True, exist_ok=True)
        stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        self.file = self.directory / f"telemetry_{stamp}.csv"
        # Line buffered so the file is always readable/downloadable mid-session.
        self._fh = open(self.file, "w", newline="", encoding="utf-8", buffering=1)
        self._writer = csv.writer(self._fh)
        self._writer.writerow(FIELDS)
        self.rows = 0
