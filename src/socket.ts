export type Signal =
  | "NOTHING"
  | "GREEN"
  | "YELLOW"
  | "RED"
  | "FCY"
  | "SC"
  | "SC_IN"
  | "PIT_CLOSED"
  | "CHEQUERED_FLAG"
  | "GT3_Q_GREEN"
  | "GT3_Q_CHQ"
  | "HYC_Q_GREEN"
  | "HYC_Q_CHQ"
  | "LMP2_Q_GREEN"
  | "LMP2_Q_CHQ"
  | "LMP3_Q_GREEN"
  | "LMP3_Q_CHQ"
  | "STARTING_SOON";

type Message = {
  type?: string;
  status?: string;
};

export type SocketStatus =
  | { type: "connected" }
  | { type: "reconnecting"; retryInSeconds: number };

type SocketHandlers = {
  onSignal: (signal: Signal) => void;
  onStatus: (status: SocketStatus) => void;
};

const SIGNALS = [
  "NOTHING",
  "GREEN",
  "YELLOW",
  "RED",
  "FCY",
  "SC",
  "SC_IN",
  "PIT_CLOSED",
  "CHEQUERED_FLAG",
  "GT3_Q_GREEN",
  "GT3_Q_CHQ",
  "HYC_Q_GREEN",
  "HYC_Q_CHQ",
  "LMP2_Q_GREEN",
  "LMP2_Q_CHQ",
  "LMP3_Q_GREEN",
  "LMP3_Q_CHQ",
  "STARTING_SOON",
] as const satisfies readonly Signal[];

const VALID_SIGNALS = new Set<Signal>(SIGNALS);

export function connectSocket(url: string, handlers: SocketHandlers) {
  let socket: WebSocket | undefined;
  let reconnectTimer: number | undefined;
  let countdownTimer: number | undefined;
  let stopped = false;
  let retryMs = 1000;

  const clearReconnectTimers = () => {
    window.clearTimeout(reconnectTimer);
    window.clearInterval(countdownTimer);
    reconnectTimer = undefined;
    countdownTimer = undefined;
  };

  const scheduleReconnect = () => {
    const retryAt = Date.now() + retryMs;
    let lastReportedSeconds = -1;

    const reportCountdown = () => {
      const retryInSeconds = Math.max(0, Math.ceil((retryAt - Date.now()) / 1000));

      if (retryInSeconds !== lastReportedSeconds) {
        lastReportedSeconds = retryInSeconds;
        handlers.onStatus({ type: "reconnecting", retryInSeconds });
      }
    };

    reportCountdown();
    countdownTimer = window.setInterval(reportCountdown, 250);
    reconnectTimer = window.setTimeout(() => {
      clearReconnectTimers();
      connect();
    }, retryMs);

    retryMs = Math.min(retryMs * 1.5, 10000);
  };

  const connect = () => {
    socket = new WebSocket(url);
    socket.onopen = () => {
      clearReconnectTimers();
      retryMs = 1000;
      handlers.onStatus({ type: "connected" });
    };

    socket.onmessage = (event) => {
      const message = parseMessage(event.data);

      if (!message) {
        return;
      }

      if (message.type === "IDLE" || message.status === "NOTHING") {
        handlers.onSignal("NOTHING");
        return;
      }

      if (message.type === "RACE_CONTROL" && isSignal(message.status)) {
        handlers.onSignal(message.status);
      }
    };

    socket.onclose = () => {
      if (!stopped) {
        scheduleReconnect();
      }
    };

    socket.onerror = () => {
      socket?.close();
    };
  };

  connect();

  return () => {
    stopped = true;
    clearReconnectTimers();
    socket?.close();
  };
}

function parseMessage(raw: string): Message | null {
  try {
    return JSON.parse(raw) as Message;
  } catch {
    return null;
  }
}

function isSignal(value: string | undefined): value is Signal {
  return Boolean(value && VALID_SIGNALS.has(value as Signal));
}
