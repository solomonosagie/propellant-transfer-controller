import { CommandPanel } from "./components/CommandPanel";
import { EventLog } from "./components/EventLog";
import { LiveCharts } from "./components/LiveCharts";
import { NoSignalOverlay } from "./components/NoSignalOverlay";
import { PressureGauge } from "./components/PressureGauge";
import { SessionPanel } from "./components/SessionPanel";
import { Sidebar } from "./components/Sidebar";
import { StateBanner } from "./components/StateBanner";
import { TankSchematic } from "./components/TankSchematic";
import { ThermalPanel } from "./components/ThermalPanel";
import { Toasts } from "./components/Toasts";
import { TopBar } from "./components/TopBar";
import { useFaultAlarm } from "./hooks/useFaultAlarm";
import { useGroundStation } from "./hooks/useGroundStation";
import { isThermalFault } from "./lib/limits";

export default function App() {
  const gs = useGroundStation();
  const faultCount = gs.log.filter((e) => e.level === "FAULT").length;
  // `fault` is set as soon as the device detects a problem, while `state` only
  // becomes FAULT once the valve is confirmed closed. Alarm on whichever comes
  // first, but stay quiet on stale data when the signal is lost.
  const inFault = !!gs.tlm && !gs.noSignal && (gs.tlm.state === "FAULT" || gs.tlm.fault !== null);
  const alarm = useFaultAlarm(inFault ? (isThermalFault(gs.tlm?.fault) ? "thermal" : "general") : null);

  return (
    <div className="flex h-full overflow-hidden">
      <Sidebar wsOpen={gs.wsOpen} linkUp={gs.linkUp} status={gs.status} hello={gs.hello} faultCount={faultCount} />

      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar linkUp={gs.linkUp} status={gs.status} tlm={gs.tlm} stats={gs.stats} now={gs.now} alarm={alarm} />

        <div className="relative min-h-0 flex-1">
          <main className="scroll-thin h-full overflow-y-auto p-4">
            <div className="mx-auto grid max-w-[1800px] grid-cols-12 gap-4">
              <div className="col-span-12">
                <StateBanner tlm={gs.tlm} stateSince={gs.stateSince} now={gs.now} />
              </div>

              <div className="col-span-12 xl:col-span-6">
                <TankSchematic tlm={gs.tlm} />
              </div>
              <div className="col-span-12 md:col-span-6 xl:col-span-3">
                <PressureGauge pressure={gs.tlm?.pressure ?? null} />
              </div>
              <div className="col-span-12 md:col-span-6 xl:col-span-3">
                <CommandPanel
                  tlm={gs.tlm}
                  linkUp={gs.linkUp}
                  noSignal={gs.noSignal}
                  sim={gs.status?.mode === "sim"}
                  sendCommand={gs.sendCommand}
                />
              </div>

              <div className="col-span-12 xl:col-span-8">
                <LiveCharts history={gs.history} now={gs.now} />
              </div>
              <div className="col-span-12 xl:col-span-4">
                <SessionPanel status={gs.status} mission={gs.mission} now={gs.now} />
              </div>

              <div className="col-span-12 xl:col-span-4">
                <ThermalPanel tlm={gs.tlm} history={gs.history} now={gs.now} sim={gs.status?.mode === "sim"} />
              </div>
              <div className="col-span-12 xl:col-span-8">
                <EventLog log={gs.log} onClear={gs.clearLog} />
              </div>
            </div>
          </main>

          <NoSignalOverlay
            active={gs.noSignal}
            wsOpen={gs.wsOpen}
            linkUp={gs.linkUp}
            status={gs.status}
            lastTlm={gs.lastTlmAt}
            now={gs.now}
          />
        </div>
      </div>

      <Toasts toasts={gs.toasts} onDismiss={gs.dismissToast} />
    </div>
  );
}
