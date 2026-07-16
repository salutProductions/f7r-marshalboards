import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useState } from "react";
import "./App.css";
import { loadConfig } from "./config";
import { getFcyCountdownDisplay } from "./countdown";
import {
  connectSocket,
  type FcyCountdown,
  type RaceState,
  type Signal,
  type SocketStatus,
} from "./socket";

const SIGNAL_LABELS: Partial<Record<Signal, string>> = {
  SC: "SC",
  FCY: "FCY",
  PIT_CLOSED: "PIT CLOSED",
  STARTING_SOON: "STARTING SOON",
  GT3_Q_CHQ: "GT3",
  HYC_Q_CHQ: "HYC",
  GT3_Q_GREEN: "GT3",
  HYC_Q_GREEN: "HYC",
  LMP2_Q_CHQ: "LMP2",
  LMP2_Q_GREEN: "LMP2",
  LMP3_Q_CHQ: "LMP3",
  LMP3_Q_GREEN: "LMP3",
  S1_Y: "S1",
  S2_Y: "S2",
  S3_Y: "S3",
  UNLAP: "SC / UNLAP",
};

function App() {
  const [signal, setSignal] = useState<Signal>("NOTHING");
  const [countdown, setCountdown] = useState<FcyCountdown | null>(null);
  const [socketStatus, setSocketStatus] = useState<SocketStatus>({
    type: "connecting",
  });
  const [clockAnchor, setClockAnchor] = useState(() => ({
    serverTimeAtSync: Date.now(),
    monotonicAtSync: performance.now(),
  }));
  const [monotonicNow, setMonotonicNow] = useState(() => performance.now());
  const [backgroundMode, setBackgroundMode] = useState<"transparent" | "black">(
    "transparent",
  );
  const [roundedCorners, setRoundedCorners] = useState(true);
  const [animationKey, setAnimationKey] = useState(0);

  function handleDragStart(event: React.MouseEvent<HTMLElement>) {
    if (event.button !== 0) {
      return;
    }

    event.preventDefault();
    getCurrentWindow().startDragging();
  }

  function handleContextMenu(event: React.MouseEvent<HTMLElement>) {
    event.preventDefault();
    event.stopPropagation();

    invoke("show_context_menu");
  }

  useEffect(() => {
    let disconnect: (() => void) | undefined;
    let cancelled = false;

    loadConfig()
      .then((config) => {
        if (cancelled) {
          return;
        }

        setRoundedCorners(config.roundedCorners);
        disconnect = connectSocket(config.websocketUrl, {
          onState(state: RaceState) {
            if (state.kind === "fcy-countdown") {
              setCountdown(state);
              setMonotonicNow(performance.now());
              return;
            }

            setCountdown(null);
            setSignal(state.signal);
            setAnimationKey((current) => current + 1);
          },
          onStatus(status) {
            setSocketStatus(status);
          },
          onClockSync(clock) {
            const now = performance.now();

            setClockAnchor({
              serverTimeAtSync: Date.now() + clock.offsetMs,
              monotonicAtSync: now,
            });
            setMonotonicNow(now);
          },
        });
      })
      .catch((error) => {
        console.error("Failed to load config:", error);
      });

    return () => {
      cancelled = true;
      disconnect?.();
    };
  }, []);

  useEffect(() => {
    if (!countdown) {
      return;
    }

    let timer: number | undefined;

    const tick = () => {
      const now = performance.now();
      const estimatedServerNow =
        clockAnchor.serverTimeAtSync + (now - clockAnchor.monotonicAtSync);

      setMonotonicNow(now);

      if (estimatedServerNow < countdown.fcyAt) {
        timer = window.setTimeout(tick, 50);
      }
    };

    tick();

    return () => window.clearTimeout(timer);
  }, [countdown, clockAnchor]);

  useEffect(() => {
    function handleKeyboardShortcut(event: KeyboardEvent) {
      if (event.altKey && event.shiftKey && event.key.toLowerCase() === "t") {
        event.preventDefault();
        setBackgroundMode((current) =>
          current === "transparent" ? "black" : "transparent",
        );
      }
    }

    window.addEventListener("keydown", handleKeyboardShortcut);

    return () => {
      window.removeEventListener("keydown", handleKeyboardShortcut);
    };
  }, []);

  const estimatedServerNow =
    clockAnchor.serverTimeAtSync +
    (monotonicNow - clockAnchor.monotonicAtSync);
  const countdownDisplay = countdown
    ? getFcyCountdownDisplay(countdown, estimatedServerNow)
    : null;
  const displaySignal = countdownDisplay?.visible ? "FCY" : signal;
  const connectionText = getConnectionText(socketStatus);
  const liveText =
    countdownDisplay?.visible
      ? countdownDisplay.remainingSeconds > 0
        ? `FCY ${countdownDisplay.remainingSeconds}`
        : "FCY"
      : connectionText ?? SIGNAL_LABELS[signal];
  const isConnected = socketStatus.type === "connected";
  const preserveCommittedCountdown = Boolean(countdownDisplay?.visible);

  return (
    <main
      key={animationKey}
      className="signal"
      onContextMenu={handleContextMenu}
      onMouseDown={handleDragStart}
      data-background={backgroundMode}
      data-connection={
        isConnected || preserveCommittedCountdown ? "connected" : "disconnected"
      }
      data-rounded-corners={roundedCorners}
      data-signal={displaySignal}
      aria-label={liveText ?? displaySignal}
    >
      {liveText && <span>{liveText}</span>}
      {preserveCommittedCountdown && !isConnected && (
        <small className="connection-warning">DSC</small>
      )}
    </main>
  );
}

function getConnectionText(status: SocketStatus) {
  switch (status.type) {
    case "connecting":
      return "CONN";
    case "syncing":
      return "SYNC";
    case "reconnecting":
      return `DSC-${status.retryInSeconds}`;
    case "connected":
      return null;
  }
}

export default App;
