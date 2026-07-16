import type { FcyCountdown } from "./countdown";
import {
  calculateClockSyncSample,
  type ClockSyncSample,
} from "./clock";

export type { FcyCountdown } from "./countdown";

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

export type RaceState =
  | { kind: "signal"; signal: Signal; eventId?: string; sequence?: number }
  | ({ kind: "fcy-countdown" } & FcyCountdown);

export type SocketStatus =
  | { type: "connecting" }
  | { type: "syncing" }
  | { type: "connected" }
  | { type: "reconnecting"; retryInSeconds: number };

export type ClockSync = {
  offsetMs: number;
  uncertaintyMs: number;
};

type SocketHandlers = {
  onState: (state: RaceState) => void;
  onStatus: (status: SocketStatus) => void;
  onClockSync: (clock: ClockSync) => void;
};

const INITIAL_RETRY_MS = 1000;
const MAX_RETRY_MS = 10000;
const CONNECT_TIMEOUT_MS = 5000;
const TIME_SYNC_INTERVAL_MS = 10000;
const STALE_CONNECTION_MS = 25000;
const TIME_SYNC_BURST_DELAYS_MS = [0, 150, 350, 700] as const;
const MAX_TIME_SYNC_SAMPLES = 8;

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
  let socket: WebSocket | undefined;
  let reconnectTimer: number | undefined;
  let countdownTimer: number | undefined;
  let heartbeatTimer: number | undefined;
  let stopped = false;
  let retryMs = INITIAL_RETRY_MS;
  let lastServerMessageAt = 0;
  let requestCounter = 0;
  let latestSequence = -1;
  let awaitingSnapshot = false;
  let timeSyncRequired = false;
  let timeSyncSamples: ClockSyncSample[] = [];

  const burstTimers = new Set<number>();
  const pendingTimeSync = new Map<string, number>();

  const clearReconnectTimers = () => {
    window.clearTimeout(reconnectTimer);
    window.clearInterval(countdownTimer);
    reconnectTimer = undefined;
    countdownTimer = undefined;
  };

  const clearConnectionTimers = () => {
    window.clearInterval(heartbeatTimer);
    heartbeatTimer = undefined;

    burstTimers.forEach((timer) => window.clearTimeout(timer));
    burstTimers.clear();
    pendingTimeSync.clear();
  };

  const scheduleReconnect = () => {
    if (reconnectTimer !== undefined || stopped) {
      return;
    }

    clearConnectionTimers();

    const retryAt = Date.now() + retryMs;
    let lastReportedSeconds = -1;

    const reportCountdown = () => {
      const retryInSeconds = Math.max(
        0,
        Math.ceil((retryAt - Date.now()) / 1000),
      );

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

    retryMs = Math.min(retryMs * 1.5, MAX_RETRY_MS);
  };

  const sendTimeSync = (currentSocket: WebSocket) => {
    if (
      stopped ||
      socket !== currentSocket ||
      currentSocket.readyState !== WebSocket.OPEN
    ) {
      return;
    }

    const requestId = `sync-${Date.now()}-${++requestCounter}`;
    const clientSentAt = Date.now();

    for (const [pendingRequestId, pendingSentAt] of pendingTimeSync) {
      if (clientSentAt - pendingSentAt > 60000) {
        pendingTimeSync.delete(pendingRequestId);
      }
    }

    pendingTimeSync.set(requestId, clientSentAt);

    try {
      currentSocket.send(
        JSON.stringify({
          type: "TIME_SYNC",
          requestId,
          clientSentAt,
        }),
      );
    } catch {
      currentSocket.close();
    }
  };

  const startTimeSync = (currentSocket: WebSocket) => {
    clearConnectionTimers();
    timeSyncSamples = [];
    lastServerMessageAt = Date.now();

    for (const delay of TIME_SYNC_BURST_DELAYS_MS) {
      const timer = window.setTimeout(() => {
        burstTimers.delete(timer);
        sendTimeSync(currentSocket);
      }, delay);

      burstTimers.add(timer);
    }

    heartbeatTimer = window.setInterval(() => {
      if (
        timeSyncRequired &&
        Date.now() - lastServerMessageAt > STALE_CONNECTION_MS
      ) {
        currentSocket.close(4000, "stale connection");
        return;
      }

      sendTimeSync(currentSocket);
    }, TIME_SYNC_INTERVAL_MS);
  };

  const handleTimeSync = (
    message: Record<string, unknown>,
    clientReceivedAt: number,
  ) => {
    if (message.type !== "TIME_SYNC" || typeof message.requestId !== "string") {
      return false;
    }

    const clientSentAt = pendingTimeSync.get(message.requestId);
    const serverReceivedAt = readFiniteNumber(message.serverReceivedAt);
    const serverSentAt = readFiniteNumber(message.serverSentAt);

    if (
      clientSentAt === undefined ||
      serverReceivedAt === undefined ||
      serverSentAt === undefined ||
      serverSentAt < serverReceivedAt
    ) {
      return true;
    }

    pendingTimeSync.delete(message.requestId);

    const sample = calculateClockSyncSample(
      clientSentAt,
      serverReceivedAt,
      serverSentAt,
      clientReceivedAt,
    );

    if (!sample) {
      return true;
    }

    timeSyncSamples.push(sample);
    timeSyncSamples = timeSyncSamples.slice(-MAX_TIME_SYNC_SAMPLES);

    const bestSample = timeSyncSamples.reduce((best, current) =>
      current.roundTripMs < best.roundTripMs ? current : best,
    );

    handlers.onClockSync({
      offsetMs: bestSample.offsetMs,
      uncertaintyMs: bestSample.uncertaintyMs,
    });

    return true;
  };

  const handleState = (
    message: Record<string, unknown>,
    clientReceivedAt: number,
  ) => {
    const sequence = readNonNegativeInteger(message.sequence);

    if (
      sequence !== undefined &&
      (sequence < latestSequence ||
        (sequence === latestSequence && !awaitingSnapshot))
    ) {
      return;
    }

    let state: RaceState | undefined;

    if (message.type === "FCY_COUNTDOWN") {
      const eventId = typeof message.eventId === "string" ? message.eventId : "";
      const countdownStartsAt = readFiniteNumber(message.countdownStartsAt);
      const fcyAt = readFiniteNumber(message.fcyAt);
      const declaredCountdownSeconds = readNonNegativeInteger(
        message.countdownSeconds,
      );

      if (
        eventId &&
        countdownStartsAt !== undefined &&
        fcyAt !== undefined &&
        fcyAt > countdownStartsAt &&
        calculatedCountdownDurationIsValid(countdownStartsAt, fcyAt)
      ) {
        const calculatedCountdownSeconds = Math.ceil(
          (fcyAt - countdownStartsAt) / 1000,
        );

        state = {
          kind: "fcy-countdown",
          eventId,
          sequence,
          countdownSeconds:
            declaredCountdownSeconds === calculatedCountdownSeconds
              ? declaredCountdownSeconds
              : calculatedCountdownSeconds,
          countdownStartsAt,
          fcyAt,
        };
      }
    } else if (message.type === "IDLE" || message.status === "NOTHING") {
      state = {
        kind: "signal",
        signal: "NOTHING",
        eventId: readString(message.eventId),
        sequence,
      };
    } else if (message.type === "RACE_CONTROL") {
      const status = readString(message.status);

      if (!isSignal(status)) {
        return;
      }

      state = {
        kind: "signal",
        signal: status,
        eventId: readString(message.eventId),
        sequence,
      };
    }

    if (!state) {
      return;
    }

    if (sequence !== undefined) {
      latestSequence = sequence;
    }

    timeSyncRequired =
      (readNonNegativeInteger(message.protocolVersion) ?? 0) >= 1;

    if (timeSyncSamples.length === 0) {
      const coarseServerTime =
        readFiniteNumber(message.snapshotAt) ??
        readFiniteNumber(message.serverSentAt);

      if (coarseServerTime !== undefined) {
        handlers.onClockSync({
          offsetMs: coarseServerTime - clientReceivedAt,
          uncertaintyMs: 250,
        });
      }
    }

    awaitingSnapshot = false;
    handlers.onState(state);
    handlers.onStatus({ type: "connected" });
  };

  const handleMessage = (raw: unknown) => {
    const clientReceivedAt = Date.now();

    if (typeof raw !== "string") {
      return;
    }

    let value: unknown;

    try {
      value = JSON.parse(raw);
    } catch {
      return;
    }

    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return;
    }

    const message = value as Record<string, unknown>;

    if (!handleTimeSync(message, clientReceivedAt)) {
      handleState(message, clientReceivedAt);
    }
  };

  const connect = () => {
    if (stopped) {
      return;
    }

    handlers.onStatus({ type: "connecting" });

    let currentSocket: WebSocket;

    try {
      currentSocket = new WebSocket(url);
    } catch {
      scheduleReconnect();
      return;
    }

    socket = currentSocket;

    const connectTimer = window.setTimeout(() => {
      currentSocket.close(4001, "connect timeout");
    }, CONNECT_TIMEOUT_MS);

    currentSocket.onopen = () => {
      window.clearTimeout(connectTimer);

      if (stopped || socket !== currentSocket) {
        currentSocket.close();
        return;
      }

      clearReconnectTimers();
      retryMs = INITIAL_RETRY_MS;
      awaitingSnapshot = true;
      timeSyncRequired = false;
      handlers.onStatus({ type: "syncing" });
      startTimeSync(currentSocket);
    };

    currentSocket.onmessage = (event) => {
      if (socket !== currentSocket) {
        return;
      }

      lastServerMessageAt = Date.now();
      handleMessage(event.data);
    };

    currentSocket.onclose = () => {
      if (socket !== currentSocket) {
        return;
      }

      window.clearTimeout(connectTimer);
      socket = undefined;
      clearConnectionTimers();

      if (!stopped) {
        scheduleReconnect();
      }
    };

    currentSocket.onerror = () => {
      currentSocket.close();
    };
  };

  connect();

  return () => {
    stopped = true;
    clearReconnectTimers();
    clearConnectionTimers();
    socket?.close();
    socket = undefined;
  };
}

function readFiniteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readNonNegativeInteger(value: unknown) {
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 0
    ? value
    : undefined;
}

function readString(value: unknown) {
  return typeof value === "string" ? value : undefined;
}

function isSignal(value: string | undefined): value is Signal {
  return Boolean(value && VALID_SIGNALS.has(value as Signal));
}

function calculatedCountdownDurationIsValid(startsAt: number, fcyAt: number) {
  const durationMs = fcyAt - startsAt;
  return durationMs >= 5000 && durationMs <= 120000;
}
