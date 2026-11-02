# Ground Station

The laptop side of the project: a Python backend that talks to the Pro Micro
over USB, and a React dashboard that shows the transfer live and lets you
control it.

```
Pro Micro --USB serial--> backend (FastAPI + pyserial) --WebSocket--> browser (React)
```

I kept the browser away from the serial port on purpose. The backend owns the
connection, so it can reconnect when the cable is pulled, keep logging to CSV
with no browser open, and ping the board every 3 seconds so the firmware's
link watchdog doesn't trip.

## Setup

You'll need Python 3.10+ and Node.js 20+. From the `ground-station` folder:

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
cd ..\frontend
npm install
npm run build
```

## Running

```powershell
cd backend
.\.venv\Scripts\python.exe main.py          # finds the Pro Micro automatically
.\.venv\Scripts\python.exe main.py --sim    # no hardware needed
```

Then open <http://127.0.0.1:8000>.

The `--sim` mode runs a Python copy of the firmware's state machine, so the
dashboard behaves exactly as it would with the board attached. It also adds
buttons to fake a pressure spike, a USB dropout and a D4 button press.

If auto-detect can't find the board, pass the port yourself with
`--port COM7`, or pick it from the dropdown in the top bar. You can list the
ports with `.\.venv\Scripts\python.exe -m serial.tools.list_ports -v`.

A few things that caught me out:

- Close the Arduino Serial Monitor first. Only one program can hold a COM port.
- The 32U4 won't send anything until the host asserts DTR. The backend
  handles it, but keep it in mind if you write your own client.
- Ports named "Standard Serial over Bluetooth link" aren't the board.

## Using the dashboard

- **Flow** follows an automatic profile by default: a soft start, a steady
  4 %/s, then a taper as Tank A empties. Press **MANUAL OVERRIDE** to set the
  rate yourself. Any fault puts it back on auto.
- **Faults** sound an alarm through the laptop speakers. Pressure and link
  faults use a two-tone siren, and temperature faults use a rising chirp.
  Click the page once after opening it, since browsers block audio until you do.
- **Buttons** grey out when the firmware would reject the command. Hover over
  one to see why.
- **NO SIGNAL** appears if telemetry stops for more than 2 seconds.

Every session is logged to `backend/logs/` as CSV, one row per telemetry
frame. You can pause and download logs from the Session panel.

## Development

For hot reload, run `main.py --sim` in one terminal and `npm run dev` in
`frontend/` in another, then open <http://localhost:5173>. Run `main.py --help`
for the rest of the options.
