import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useRef, useState } from "react";
import "./App.css";
import { type CarCategory, loadConfig } from "./config";
import { connectSocket, type Signal } from "./socket";

const SIGNAL_LABELS: Partial<Record<Signal, string>> = {
  SC: "SC",
  FCY: "FCY",
  PIT_CLOSED: "PIT CLOSED",
  STARTING_SOON: "STARTING SOON",
  GT3_Q_CHQ: "GT3 - CHQ",
  HYC_Q_CHQ: "HYC - CHQ",
  GT3_Q_GREEN: "GT3 - GREEN",
  HYC_Q_GREEN: "HYC - GREEN",
};

const CATEGORY_PREFIXES: Record<CarCategory, string> = {
  GT3: "GT3_",
  HYPERCAR: "HYC_",
};

const CLASS_SIGNAL_PREFIXES = Object.values(CATEGORY_PREFIXES);

function App() {
  const [signal, setSignal] = useState<Signal>("NOTHING");
  const [retryInSeconds, setRetryInSeconds] = useState<number | null>(null);
  const [backgroundMode, setBackgroundMode] = useState<"transparent" | "black">(
    "transparent",
  );
  const [animationKey, setAnimationKey] = useState(0);
  const categoryRef = useRef<CarCategory>("GT3");
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

        categoryRef.current = config.carCategory;

        disconnect = connectSocket(config.websocketUrl, {
          onSignal(nextSignal) {
            setSignal(filterSignalForCategory(nextSignal, categoryRef.current));
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
    let unlisten: (() => void) | undefined;

    listen<CarCategory>("car-category-changed", (event) => {
      categoryRef.current = event.payload;
      setSignal("NOTHING");
      setAnimationKey((current) => current + 1);
    }).then((cleanup) => {
      unlisten = cleanup;
    });

    return () => {
      unlisten?.();
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
      data-signal={signal}
      aria-label={liveText ?? signal}
    >
      {liveText && <span>{liveText}</span>}
    </main>
  );
}

function filterSignalForCategory(signal: Signal, category: CarCategory): Signal {
  if (!isClassSignal(signal)) {
    return signal;
  }

  if (signal.startsWith(CATEGORY_PREFIXES[category])) {
    return signal;
  }

  return "NOTHING";
}

function isClassSignal(signal: Signal) {
  return CLASS_SIGNAL_PREFIXES.some((prefix) => signal.startsWith(prefix));
}

export default App;
