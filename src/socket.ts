export type Signal =
  | "NOTHING"
  | "GREEN"
  | "YELLOW"
  | "RED"
  | "FCY"
  | "SC"
  | "SC_IN"
  | "PIT_CLOSED"
  | "STARTING_SOON";

type Message = {
  type?: string;
  status?: string;
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
  "STARTING_SOON",
] as const satisfies readonly Signal[];

const VALID_SIGNALS = new Set<Signal>(SIGNALS);

export function connectSocket(url: string, onSignal: (signal: Signal) => void) {
  let socket: WebSocket | undefined;
  let stopped = false;
  let retryMs = 1000;

  const connect = () => {
    socket = new WebSocket(url);
    socket.onopen = () => {
      retryMs = 1000;
    };

    socket.onmessage = (event) => {
      const message = parseMessage(event.data);

      if (!message) {
        return;
      }

      if (message.type === "IDLE" || message.status === "NOTHING") {
        onSignal("NOTHING");
        return;
      }

      if (message.type === "RACE_CONTROL" && isSignal(message.status)) {
        onSignal(message.status);
      }
    };

    socket.onclose = () => {
      if (!stopped) {
        window.setTimeout(connect, retryMs);
        retryMs = Math.min(retryMs * 1.5, 10000);
      }
    };

    socket.onerror = () => {
      socket?.close();
    };
  };

  connect();

  return () => {
    stopped = true;
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
