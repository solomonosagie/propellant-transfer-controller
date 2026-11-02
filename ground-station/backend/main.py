"""PROP-XFER-01 ground station backend.

Bridges the propellant transfer controller (USB serial or --sim) to browser
clients over a WebSocket, logs telemetry to CSV and keeps the device's link
watchdog fed with a PING every 3 s.

Run:  python main.py            (auto-detect the Pro Micro)
      python main.py --port COM5
      python main.py --sim
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import re
import time
from collections import deque
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

import uvicorn
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.responses import Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from protocol import MAX_ECHO_CHARS, normalize_command, parse_line
from serial_link import SerialLink, list_serial_ports
from simulator import Simulator
from telemetry_log import TelemetryLogger

PING_INTERVAL_S = 3.0
STATUS_INTERVAL_S = 1.0
HISTORY_SIZE = 300
CLIENT_QUEUE_SIZE = 1000
FRONTEND_DIST = Path(__file__).resolve().parent.parent / "frontend" / "dist"
LOG_NAME_RE = re.compile(r"^[\w\-.]+\.csv$")

log = logging.getLogger("ground-station")


def now_ms() -> float:
    return time.time() * 1000


class GroundStation:
    """Owns the device link, the CSV logger and the connected browser clients."""

    def __init__(self, args: argparse.Namespace) -> None:
        self.args = args
        self.logger = TelemetryLogger(Path(args.log_dir), enabled=not args.no_log)
        self.clients: set[asyncio.Queue[str]] = set()
        self.history: deque[dict[str, Any]] = deque(maxlen=HISTORY_SIZE)
        self.hello: dict[str, Any] | None = None
        self.rx_lines = 0
        self.parse_errors = 0
        self.loop: asyncio.AbstractEventLoop | None = None
        self.link: SerialLink | Simulator | None = None
        self._tasks: list[asyncio.Task] = []

    # ---- lifecycle --------------------------------------------------------
    async def start(self) -> None:
        self.loop = asyncio.get_running_loop()
        if self.args.sim:
            self.link = Simulator(self._on_line_threadsafe, self._on_status_threadsafe)
        else:
            self.link = SerialLink(self.args.baud, self.args.port, self._on_line_threadsafe, self._on_status_threadsafe)
        self.link.start()
        self._tasks = [asyncio.create_task(self._ping_loop()), asyncio.create_task(self._status_loop())]
        log.info("Ground station started in %s mode", self.link.mode)

    async def stop(self) -> None:
        for task in self._tasks:
            task.cancel()
        if self.link:
            await self.link.stop()
        self.logger.close()

    # ---- inbound from device ---------------------------------------------
    # The serial link calls these from its own thread; hop onto the event loop.
    def _on_line_threadsafe(self, raw: bytes) -> None:
        assert self.loop
        self.loop.call_soon_threadsafe(self._on_line, raw)

    def _on_status_threadsafe(self, connected: bool, port: str | None, error: str | None) -> None:
        assert self.loop
        self.loop.call_soon_threadsafe(self._on_status, connected, port, error)

    def _on_line(self, raw: bytes) -> None:
        msg, error, text = parse_line(raw)
        if msg is None and error is None:
            return
        self.rx_lines += 1
        if error:
            self.parse_errors += 1
            msg = {"type": "parse_error", "error": error, "line": text[:MAX_ECHO_CHARS]}
        assert msg is not None
        msg["rx"] = now_ms()

        kind = msg["type"]
        if kind == "tlm":
            try:
                self.logger.log(msg)
            except OSError as exc:
                log.error("CSV logging failed: %s", exc)
                self.logger.set_enabled(False)
        elif kind == "hello":
            self.hello = msg
        if self._keep_in_history(msg):
            self.history.append(msg)
        self.publish(msg)

    def _on_status(self, connected: bool, port: str | None, error: str | None) -> None:
        msg = {"type": "link", "connected": connected, "port": port, "error": error, "mode": self.mode, "rx": now_ms()}
        log.info("Link %s %s %s", "UP" if connected else "DOWN", port or "", error or "")
        self.history.append(msg)
        self.publish(msg)

    # The history buffer is replayed to every browser that connects, so a page
    # refresh doesn't lose the event log. Telemetry and keep-alive PING acks are
    # left out; they would push the interesting events out of the buffer in seconds.
    @staticmethod
    def _keep_in_history(msg: dict[str, Any]) -> bool:
        kind = msg["type"]
        if kind == "ack":
            return not (msg.get("cmd") == "PING" and msg.get("ok"))
        return kind in ("evt", "hello", "parse_error", "cmd_sent")

    # ---- outbound to device ------------------------------------------------
    def send_command(self, raw: str) -> tuple[bool, str]:
        cmd = normalize_command(raw)
        if cmd is None:
            return False, "INVALID_COMMAND"
        if not self.link or not self.link.send(cmd):
            return False, "LINK_DOWN"
        if cmd != "PING":
            msg = {"type": "cmd_sent", "cmd": cmd, "rx": now_ms()}
            self.history.append(msg)
            self.publish(msg)
        return True, ""

    async def _ping_loop(self) -> None:
        # The firmware faults with LINK_LOSS after 10 s without traffic.
        while True:
            await asyncio.sleep(PING_INTERVAL_S)
            if self.link and self.link.connected:
                self.send_command("PING")

    async def _status_loop(self) -> None:
        while True:
            await asyncio.sleep(STATUS_INTERVAL_S)
            self.publish(self.status())

    # ---- browser side ------------------------------------------------------
    @property
    def mode(self) -> str:
        return "sim" if self.args.sim else "serial"

    def status(self) -> dict[str, Any]:
        link = self.link
        return {
            "type": "status",
            "mode": self.mode,
            "link": {
                "connected": bool(link and link.connected),
                "port": link.port if link else None,
                "requested_port": link.requested_port if link else None,
                "error": link.error if link else None,
            },
            "logging": {
                "enabled": self.logger.enabled,
                "file": self.logger.file.name if self.logger.file else None,
                "rows": self.logger.rows,
            },
            "stats": {"rx_lines": self.rx_lines, "parse_errors": self.parse_errors, "clients": len(self.clients)},
            "hello": self.hello,
            "rx": now_ms(),
        }

    def publish(self, msg: dict[str, Any]) -> None:
        data = json.dumps(msg, separators=(",", ":"))
        for q in list(self.clients):
            try:
                q.put_nowait(data)
            except asyncio.QueueFull:
                pass  # slow client: drop rather than stall the link


# ---- HTTP / WebSocket API ----------------------------------------------------


class PortRequest(BaseModel):
    port: str | None = None


class LoggingRequest(BaseModel):
    enabled: bool


def create_app(gs: GroundStation) -> FastAPI:
    @asynccontextmanager
    async def lifespan(_: FastAPI):
        await gs.start()
        yield
        await gs.stop()

    app = FastAPI(title="PROP-XFER-01 Ground Station", lifespan=lifespan)

    @app.get("/api/status")
    def get_status() -> dict[str, Any]:
        return gs.status()

    @app.get("/api/ports")
    def get_ports() -> dict[str, Any]:
        return {"mode": gs.mode, "ports": list_serial_ports(), "requested": gs.link.requested_port if gs.link else None}

    @app.post("/api/port")
    def set_port(req: PortRequest) -> dict[str, Any]:
        if gs.mode == "sim":
            raise HTTPException(400, "Port selection is not available in --sim mode")
        assert gs.link
        gs.link.set_port(req.port)
        return {"ok": True, "requested": req.port}

    @app.post("/api/logging")
    def set_logging(req: LoggingRequest) -> dict[str, Any]:
        gs.logger.set_enabled(req.enabled)
        gs.publish(gs.status())
        return {"ok": True, "enabled": gs.logger.enabled}

    @app.get("/api/logs")
    def list_logs() -> dict[str, Any]:
        return {"files": gs.logger.list_files()}

    @app.get("/api/logs/{name}")
    def download_log(name: str) -> Response:
        log_dir = gs.logger.directory.resolve()
        path = (log_dir / name).resolve()
        if not LOG_NAME_RE.match(name) or path.parent != log_dir or not path.is_file():
            raise HTTPException(404, "Log not found")
        # Read into memory: the active file may still be growing.
        return Response(
            content=path.read_bytes(),
            media_type="text/csv",
            headers={"Content-Disposition": f'attachment; filename="{name}"'},
        )

    # Declared async on purpose: FastAPI runs sync handlers in a thread pool, and
    # the simulator must only be touched from the event loop thread.
    @app.post("/api/sim/{action}")
    async def sim_action(action: str) -> dict[str, Any]:
        if not isinstance(gs.link, Simulator):
            raise HTTPException(404, "Simulator not running")
        if action == "spike":
            gs.link.spike()
        elif action == "dropout":
            gs.link.dropout()
        elif action == "button":
            gs.link.press_temp_button()
        else:
            raise HTTPException(404, "Unknown action")
        return {"ok": True}

    @app.websocket("/ws")
    async def websocket_endpoint(ws: WebSocket) -> None:
        await ws.accept()
        queue: asyncio.Queue[str] = asyncio.Queue(maxsize=CLIENT_QUEUE_SIZE)
        gs.clients.add(queue)
        await ws.send_text(json.dumps(gs.status()))
        await ws.send_text(json.dumps({"type": "history", "items": list(gs.history)}))

        async def sender() -> None:
            while True:
                await ws.send_text(await queue.get())

        send_task = asyncio.create_task(sender())
        try:
            while True:
                try:
                    data = json.loads(await ws.receive_text())
                except json.JSONDecodeError:
                    continue
                if isinstance(data, dict) and data.get("type") == "cmd":
                    raw = str(data.get("cmd", ""))
                    ok, reason = gs.send_command(raw)
                    if not ok:
                        # Rejected before reaching the device: answer this client directly.
                        await ws.send_text(
                            json.dumps({"type": "ack", "cmd": raw[:40].upper(), "ok": False, "reason": reason, "rx": now_ms(), "local": True})
                        )
        except WebSocketDisconnect:
            pass
        finally:
            send_task.cancel()
            gs.clients.discard(queue)

    if FRONTEND_DIST.is_dir():
        app.mount("/", StaticFiles(directory=FRONTEND_DIST, html=True), name="frontend")

    return app


def main() -> None:
    parser = argparse.ArgumentParser(description="PROP-XFER-01 ground station backend")
    parser.add_argument("--sim", action="store_true", help="simulate the device (no hardware needed)")
    parser.add_argument("--port", help="serial port, e.g. COM5 (default: auto-detect the Pro Micro)")
    parser.add_argument("--baud", type=int, default=115200)
    parser.add_argument("--host", default="127.0.0.1", help="HTTP bind address")
    parser.add_argument("--http-port", type=int, default=8000)
    parser.add_argument("--log-dir", default="./logs", help="CSV telemetry directory")
    parser.add_argument("--no-log", action="store_true", help="start with CSV logging disabled")
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    app = create_app(GroundStation(args))
    uvicorn.run(app, host=args.host, port=args.http_port, log_level="warning")


if __name__ == "__main__":
    main()
