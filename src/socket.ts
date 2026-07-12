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
  | "STARTING_SOON"
  | "S1_Y"
  | "S2_Y"
  | "S3_Y"
  | "UNLAP";

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

const INITIAL_RETRY_MS = 1000;
const MAX_RETRY_MS = 10000;
const SOCKET_REFRESH_MS = 30000;
const REFRESH_CONNECT_TIMEOUT_MS = 5000;

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
  "S1_Y",
  "S2_Y",
  "S3_Y",
  "UNLAP",
] as const satisfies readonly Signal[];

const VALID_SIGNALS = new Set<Signal>(SIGNALS);

export function connectSocket(url: string, handlers: SocketHandlers) {
  const sockets = new Set<WebSocket>();
  let activeSocket: WebSocket | undefined;
  let reconnectTimer: number | undefined;
  let countdownTimer: number | undefined;
  let refreshTimer: number | undefined;
  let stopped = false;
  let retryMs = INITIAL_RETRY_MS;

  const clearReconnectTimers = () => {
    window.clearTimeout(reconnectTimer);
    window.clearInterval(countdownTimer);
    reconnectTimer = undefined;
    countdownTimer = undefined;
  };

  const clearRefreshTimer = () => {
    window.clearTimeout(refreshTimer);
    refreshTimer = undefined;
  };

  const scheduleReconnect = () => {
    if (reconnectTimer !== undefined || stopped) {
      return;
    }

    clearRefreshTimer();

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
      connect("primary");
    }, retryMs);

    retryMs = Math.min(retryMs * 1.5, MAX_RETRY_MS);
  };

  const scheduleRefresh = () => {
    if (refreshTimer !== undefined || stopped) {
      return;
    }

    refreshTimer = window.setTimeout(() => {
      clearRefreshTimer();

      if (!activeSocket || activeSocket.readyState !== WebSocket.OPEN) {
        activeSocket?.close();
        activeSocket = undefined;
        scheduleReconnect();
        return;
      }

      connect("refresh");
    }, SOCKET_REFRESH_MS);
  };

  const handleMessage = (raw: unknown) => {
    const message = parseMessage(raw);

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

  const connect = (mode: "primary" | "refresh") => {
    const socket = new WebSocket(url);
    let refreshConnectTimer: number | undefined;
    sockets.add(socket);

    const clearRefreshConnectTimer = () => {
      window.clearTimeout(refreshConnectTimer);
      refreshConnectTimer = undefined;
    };

    if (mode === "refresh") {
      refreshConnectTimer = window.setTimeout(() => {
        socket.close();
      }, REFRESH_CONNECT_TIMEOUT_MS);
    }

    socket.onopen = () => {
      clearReconnectTimers();
      clearRefreshConnectTimer();

      if (stopped) {
        socket.close();
        return;
      }

      retryMs = INITIAL_RETRY_MS;

      const previousSocket = activeSocket;
      activeSocket = socket;

      if (previousSocket && previousSocket !== socket) {
        previousSocket.close(1000, "refresh");
      }

      scheduleRefresh();
      handlers.onStatus({ type: "connected" });
    };

    socket.onmessage = (event) => {
      if (activeSocket === socket) {
        handleMessage(event.data);
      }
    };

    socket.onclose = () => {
      sockets.delete(socket);
      clearRefreshConnectTimer();

      if (stopped) {
        return;
      }

      if (activeSocket === socket) {
        activeSocket = undefined;
        scheduleReconnect();
        return;
      }

      if (!activeSocket) {
        scheduleReconnect();
        return;
      }

      if (mode === "refresh") {
        scheduleRefresh();
      }
    };

    socket.onerror = () => {
      socket.close();
    };
  };

  connect("primary");

  return () => {
    stopped = true;
    clearReconnectTimers();
    clearRefreshTimer();
    activeSocket?.close();
    sockets.forEach((socket) => {
      socket.close();
    });
    sockets.clear();
  };
}

function parseMessage(raw: unknown): Message | null {
  if (typeof raw !== "string") {
    return null;
  }

  try {
    const value: unknown = JSON.parse(raw);

    if (!value || typeof value !== "object") {
      return null;
    }

    const message = value as Record<string, unknown>;

    return {
      type: typeof message.type === "string" ? message.type : undefined,
      status: typeof message.status === "string" ? message.status : undefined,
    };
  } catch {
    return null;
  }
}

function isSignal(value: string | undefined): value is Signal {
  return Boolean(value && VALID_SIGNALS.has(value as Signal));
}
