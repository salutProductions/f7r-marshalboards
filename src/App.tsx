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
  STARTING_SOON: "TEST",
};

function App() {
  const [signal, setSignal] = useState<Signal>("NOTHING");
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

        disconnect = connectSocket(config.websocketUrl, (nextSignal) => {
          setSignal(nextSignal);
          setAnimationKey((current) => current + 1);
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

  return (
    <main
      key={animationKey}
      className="signal"
      onContextMenu={handleContextMenu}
      onMouseDown={handleDragStart}
      data-signal={signal}
      aria-label={signal}
    >
      {SIGNAL_LABELS[signal] && <span>{SIGNAL_LABELS[signal]}</span>}
    </main>
  );
}

export default App;
