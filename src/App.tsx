import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { useEffect, useRef, useState } from "react";
import "./App.css";
import { createAudioController, type AudioController } from "./audio";
import { loadConfig, saveConfig, type AppConfig } from "./config";
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
  ABORT: "ABORT LAP",
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
    "black",
  );
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [animationKey, setAnimationKey] = useState(0);
  const [stateRevision, setStateRevision] = useState(0);

  const audioRef = useRef<AudioController | null>(null);
  const configRef = useRef<AppConfig | null>(null);
  configRef.current = config;

  useEffect(() => {
    async function runUpdateCheck() {
      try {
        const update = await check();
        if (update) {
          console.log(`Found update: ${update.version}`);
          await update.downloadAndInstall();
          await relaunch();
        }
      } catch (error) {
        console.error("Failed to check for updates:", error);
      }
    }

    runUpdateCheck();
  }, []);

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

    invoke("show_context_menu", {
      audioEnabled: configRef.current?.audioEnabled ?? true,
      transparencyEnabled: configRef.current?.transparency ?? false,
    });
  }

  useEffect(() => {
    let cancelled = false;

    loadConfig()
      .then((loaded) => {
        if (!cancelled) {
          setConfig(loaded);
          setBackgroundMode(loaded.transparency ? "transparent" : "black");
        }
      })
      .catch((error) => {
        console.error("Failed to load config:", error);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!config) {
      return;
    }

    if (!audioRef.current) {
      audioRef.current = createAudioController({
        enabled: config.audioEnabled,
        volume: config.audioVolume,
      });
    } else {
      audioRef.current.setEnabled(config.audioEnabled);
      audioRef.current.setVolume(config.audioVolume);
    }
  }, [config]);

  useEffect(() => {
    return () => {
      audioRef.current?.dispose();
      audioRef.current = null;
    };
  }, []);

  const websocketUrl = config?.websocketUrl;

  useEffect(() => {
    if (!websocketUrl) {
      return;
    }

    const disconnect = connectSocket(websocketUrl, {
      onState(state: RaceState) {
        audioRef.current?.onState(state);

        if (state.kind === "fcy-countdown") {
          setCountdown(state);
          setMonotonicNow(performance.now());
          return;
        }

        setCountdown(null);
        setSignal(state.signal);
        setAnimationKey((current) => current + 1);
        setStateRevision((current) => current + 1);
      },
      onStatus(status) {
        audioRef.current?.onStatus(status);
        setSocketStatus(status);
      },
      onClockSync(clock) {
        audioRef.current?.onClockSync(clock);

        const now = performance.now();

        setClockAnchor({
          serverTimeAtSync: Date.now() + clock.offsetMs,
          monotonicAtSync: now,
        });
        setMonotonicNow(now);
      },
    });

    return () => {
      disconnect();
    };
  }, [websocketUrl]);

  useEffect(() => {
    let cancelled = false;
    let unlistens: UnlistenFn[] = [];

    Promise.all([
      listen<AppConfig>("config-updated", (event) => {
        setConfig(event.payload);
        setBackgroundMode(
          event.payload.transparency ? "transparent" : "black",
        );
      }),
      listen("toggle-audio", () => {
        const current = configRef.current;

        if (!current) {
          return;
        }

        saveConfig({ ...current, audioEnabled: !current.audioEnabled }).catch(
          (error) => {
            console.error("Failed to save config:", error);
          },
        );
      }),
      listen("toggle-transparency", () => {
        const current = configRef.current;

        if (!current) {
          return;
        }

        saveConfig({ ...current, transparency: !current.transparency }).catch(
          (error) => {
            console.error("Failed to save transparency setting:", error);
          },
        );
      }),
    ]).then((fns) => {
      if (cancelled) {
        fns.forEach((unlisten) => unlisten());
      } else {
        unlistens = fns;
      }
    });

    return () => {
      cancelled = true;
      unlistens.forEach((unlisten) => unlisten());
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
        const current = configRef.current;

        if (!current) {
          return;
        }

        saveConfig({ ...current, transparency: !current.transparency }).catch(
          (error) => {
            console.error("Failed to save transparency setting:", error);
          },
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

  useEffect(() => {
    if (!config?.simhubRelayEnabled) {
      return;
    }

    invoke("publish_simhub_state", {
      signal: displaySignal,
      remainingSeconds: countdownDisplay?.visible
        ? countdownDisplay.remainingSeconds
        : null,
      countdownSeconds: countdownDisplay?.visible
        ? countdown?.countdownSeconds ?? null
        : null,
    }).catch((error) => console.error("Failed to publish SimHub state:", error));
  }, [config?.simhubRelayEnabled, displaySignal, countdownDisplay?.visible, countdownDisplay?.remainingSeconds, countdown?.countdownSeconds, stateRevision]);

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
      data-rounded-corners={config?.roundedCorners ?? true}
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
