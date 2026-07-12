import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useState } from "react";
import "./App.css";
import { loadConfig } from "./config";
import { connectSocket, type Signal } from "./socket";

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
  UNLAP: "SC / UNLAP"
};

function App() {
  const [signal, setSignal] = useState<Signal>("NOTHING");
  const [retryInSeconds, setRetryInSeconds] = useState<number | null>(null);
  const [backgroundMode, setBackgroundMode] = useState<"transparent" | "black">(
    "transparent",
  );
  const [roundedCorners, setRoundedCorners] = useState(true);
  const [animationKey, setAnimationKey] = useState(0);
  const currentWindow = getCurrentWindow();

  function handleDragStart(event: React.MouseEvent<HTMLElement>) {
    if (event.button !== 0) {
      return;
    }

    event.preventDefault();
    currentWindow.startDragging();
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
          onSignal(nextSignal) {
            setSignal(nextSignal);
            setAnimationKey((current) => current + 1);
          },
          onStatus(status) {
            if (status.type === "connected") {
              setRetryInSeconds(null);
              return;
            }

            setRetryInSeconds(status.retryInSeconds);
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

  const liveText =
    retryInSeconds === null ? SIGNAL_LABELS[signal] : `DSC-${retryInSeconds}`;

  return (
    <main
      key={animationKey}
      className="signal"
      onContextMenu={handleContextMenu}
      onMouseDown={handleDragStart}
      data-background={backgroundMode}
      data-connection={retryInSeconds === null ? "connected" : "disconnected"}
      data-rounded-corners={roundedCorners}
      data-signal={signal}
      aria-label={liveText ?? signal}
    >
      {liveText && <span>{liveText}</span>}
    </main>
  );
}

export default App;
