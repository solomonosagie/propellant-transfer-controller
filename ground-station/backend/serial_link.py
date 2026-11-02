"""USB serial link to the Pro Micro, run on a background thread.

The thread owns the port: it (re)connects, splits incoming bytes into lines
and writes queued commands. If the board is unplugged it keeps retrying, so
plugging it back in reconnects automatically.
"""

from __future__ import annotations

import queue
import threading
from typing import Callable

import serial
from serial.tools import list_ports

SPARKFUN_VID = 0x1B4F
ARDUINO_VIDS = {0x2341, 0x2A03}
LEONARDO_PIDS = {0x0036, 0x8036, 0x0037, 0x8037}  # 32U4 boards using the Leonardo VID/PID

RETRY_S = 1.0
MAX_LINE_BYTES = 4096

LineCallback = Callable[[bytes], None]
StatusCallback = Callable[[bool, "str | None", "str | None"], None]


def _score(p: list_ports.ListPortInfo) -> int:
    text = f"{p.description or ''} {p.product or ''} {p.manufacturer or ''}".lower()
    if p.vid == SPARKFUN_VID or "pro micro" in text:
        return 3
    if p.vid in ARDUINO_VIDS and p.pid in LEONARDO_PIDS:
        return 2
    if p.vid in ARDUINO_VIDS or "arduino" in text or "leonardo" in text:
        return 1
    return 0


def list_serial_ports() -> list[dict]:
    return [
        {
            "device": p.device,
            "description": p.description,
            "vid": f"{p.vid:04X}" if p.vid is not None else None,
            "pid": f"{p.pid:04X}" if p.pid is not None else None,
            "likely": _score(p) > 0,
        }
        for p in sorted(list_ports.comports(), key=lambda p: p.device)
    ]


def find_pro_micro() -> str | None:
    candidates = [(s, p.device) for p in list_ports.comports() if (s := _score(p)) > 0]
    if not candidates:
        return None
    candidates.sort(key=lambda c: (-c[0], c[1]))
    return candidates[0][1]


class SerialLink:
    mode = "serial"

    def __init__(self, baud: int, port: str | None, on_line: LineCallback, on_status: StatusCallback) -> None:
        self.baud = baud
        self.requested_port = port  # None = auto-detect
        self.port: str | None = None
        self.connected = False
        self.error: str | None = None
        self._on_line = on_line
        self._on_status = on_status
        self._tx: queue.Queue[str] = queue.Queue()
        self._stop = threading.Event()
        self._reopen = threading.Event()
        self._thread = threading.Thread(target=self._run, name="serial-link", daemon=True)
        self._ser: serial.Serial | None = None

    # ---- public API (called from the asyncio thread) -------------------------
    def start(self) -> None:
        self._thread.start()

    async def stop(self) -> None:
        self._stop.set()
        self._thread.join(timeout=2)

    def send(self, line: str) -> bool:
        if not self.connected:
            return False
        self._tx.put(line)
        return True

    def set_port(self, port: str | None) -> None:
        self.requested_port = port or None
        self._reopen.set()

    # ---- worker thread ------------------------------------------------------
    def _set_status(self, connected: bool, port: str | None, error: str | None) -> None:
        if (connected, port, error) == (self.connected, self.port, self.error):
            return
        self.connected, self.port, self.error = connected, port, error
        self._on_status(connected, port, error)

    def _close(self) -> None:
        if self._ser is not None:
            try:
                self._ser.close()
            except Exception:
                pass
        self._ser = None
        # Drop anything queued for the old connection.
        while not self._tx.empty():
            self._tx.get_nowait()

    def _open(self) -> bool:
        port = self.requested_port or find_pro_micro()
        if not port:
            self._set_status(False, None, "No Pro Micro detected (auto-detect)")
            return False
        try:
            ser = serial.Serial(port, self.baud, timeout=0.05, write_timeout=0.5)
            ser.dtr = True  # 32U4 USB CDC only transmits once the host asserts DTR
            ser.reset_input_buffer()
        except (serial.SerialException, OSError) as exc:
            self._set_status(False, port, f"Cannot open {port}: {exc}")
            return False
        self._ser = ser
        self._set_status(True, port, None)
        return True

    def _run(self) -> None:
        buf = bytearray()
        while not self._stop.is_set():
            if self._reopen.is_set():
                self._reopen.clear()
                self._close()
                self._set_status(False, None, "Switching port")

            if self._ser is None:
                buf.clear()
                if not self._open():
                    self._stop.wait(RETRY_S)
                continue

            try:
                chunk = self._ser.read(self._ser.in_waiting or 1)
                if chunk:
                    buf.extend(chunk)
                    while (idx := buf.find(b"\n")) >= 0:
                        line = bytes(buf[:idx])
                        del buf[: idx + 1]
                        self._on_line(line)
                    if len(buf) > MAX_LINE_BYTES:  # runaway line with no newline
                        self._on_line(bytes(buf))
                        buf.clear()

                while True:
                    try:
                        cmd = self._tx.get_nowait()
                    except queue.Empty:
                        break
                    self._ser.write((cmd + "\n").encode("ascii"))
            except (serial.SerialException, OSError) as exc:
                port = self.port
                self._close()
                self._set_status(False, port, f"Link lost: {exc}")
                self._stop.wait(RETRY_S)

        self._close()
