import { getFcyCountdownDisplay, type FcyCountdown } from "./countdown";
import type { ClockSync, RaceState, Signal, SocketStatus } from "./socket";

export const SIGNAL_CLIPS: Partial<Record<Signal, string>> = {
  GREEN: "green",
  YELLOW: "yellow", 
  RED: "red",
  FCY: "fcy",
  SC: "sc",
  SC_IN: "sc-in",
  PIT_CLOSED: "pit-closed",
  UNLAP: "unlap",
  S1_Y: "s1-yellow",
  S2_Y: "s2-yellow",
  S3_Y: "s3-yellow",
  GT3_Q_GREEN: "gt3-q-green",
  GT3_Q_CHQ: "gt3-q-chq",
  HYC_Q_GREEN: "hyc-q-green",
  HYC_Q_CHQ: "hyc-q-chq",
  LMP2_Q_GREEN: "lmp2-q-green",
  LMP2_Q_CHQ: "lmp2-q-chq",
  LMP3_Q_GREEN: "lmp3-q-green",
  LMP3_Q_CHQ: "lmp3-q-chq",
  STARTING_SOON: "starting-soon",
};

const COUNTDOWN_TICK_MS = 100;
const FINAL_COUNTDOWN_FROM = 5;
const MILESTONE_SECONDS: readonly number[] = [120, 90, 60, 45, 30, 20, 15, 10];

export type AudioPlayer = {
  play(candidates: readonly string[]): void;
  stop(): void;
  setVolume(volume: number): void;
  prepare(clipId: string): void;
  dispose(): void;
};

export type AudioController = {
  onState(state: RaceState): void;
  onStatus(status: SocketStatus): void;
  onClockSync(clock: ClockSync): void;
  setEnabled(enabled: boolean): void;
  isEnabled(): boolean;
  setVolume(volume: number): void;
  dispose(): void;
};

type AudioControllerOptions = {
  enabled: boolean;
  volume: number;
  player?: AudioPlayer;
  now?: () => number;
};

function clampVolume(volume: number) {
  return Number.isFinite(volume) ? Math.min(1, Math.max(0, volume)) : 1;
}

const CLIP_EXTENSIONS = ["mp3", "ogg", "opus", "wav"] as const;

export function createHtmlAudioPlayer(): AudioPlayer {
  type Entry = { element: HTMLAudioElement; failed: boolean };

  const entries = new Map<string, Entry>();
  let volume = 1;
  let current: HTMLAudioElement | null = null;
  let attempt: { candidates: readonly string[]; index: number } | null = null;

  const expand = (clipIds: readonly string[]) =>
    clipIds.flatMap((clipId) =>
      CLIP_EXTENSIONS.map((extension) => `${clipId}.${extension}`),
    );

  const ensure = (fileName: string): Entry => {
    const existing = entries.get(fileName);

    if (existing) {
      return existing;
    }

    const element = new Audio(`/audio/${fileName}`);
    element.preload = "auto";

    const entry: Entry = { element, failed: false };

    element.addEventListener("error", () => {
      entry.failed = true;

      if (attempt && attempt.candidates[attempt.index] === fileName) {
        attempt.index += 1;
        tryPlay();
      }
    });

    entries.set(fileName, entry);

    return entry;
  };

  const tryPlay = () => {
    if (!attempt) {
      return;
    }

    while (attempt.index < attempt.candidates.length) {
      const fileName = attempt.candidates[attempt.index];
      const entry = ensure(fileName);

      if (entry.failed) {
        attempt.index += 1;
        continue;
      }

      current?.pause();
      current = entry.element;
      entry.element.volume = volume;
      entry.element.currentTime = 0;
      entry.element.play().catch(() => {
        if (entry.element.error && attempt) {
          entry.failed = true;
          attempt.index += 1;
          tryPlay();
        }
      });

      return;
    }

    attempt = null;
  };

  return {
    play(candidates) {
      attempt = { candidates: expand(candidates), index: 0 };
      tryPlay();
    },
    stop() {
      attempt = null;
      current?.pause();
    },
    setVolume(next) {
      volume = clampVolume(next);

      if (current) {
        current.volume = volume;
      }
    },
    prepare(clipId) {
      expand([clipId]).forEach(ensure);
    },
    dispose() {
      attempt = null;
      current = null;

      entries.forEach((entry) => {
        entry.element.pause();
        entry.element.removeAttribute("src");
      });
      entries.clear();
    },
  };
}

export function createAudioController(
  options: AudioControllerOptions,
): AudioController {
  const player = options.player ?? createHtmlAudioPlayer();
  const now = options.now ?? (() => performance.now());

  let enabled = options.enabled;
  let lastSignal: Signal | null = null;
  let suppressNext = false;
  let clockAnchor: { serverTimeAtSync: number; monotonicAtSync: number } | null =
    null;

  let countdown: FcyCountdown | null = null;
  let phase: {
    eventId: string;
    startPlayed: boolean;
    lastMilestone: number;
    lastNumber: number;
    activationPlayed: boolean;
  } | null = null;
  let intervalId: ReturnType<typeof setInterval> | undefined;

  player.setVolume(clampVolume(options.volume));
  Object.values(SIGNAL_CLIPS).forEach((clip) => player.prepare(clip));
  player.prepare("fcy-starting");

  for (let number = 1; number <= FINAL_COUNTDOWN_FROM; number += 1) {
    player.prepare(String(number));
  }

  const play = (clip: string | readonly string[]) => {
    if (!enabled) {
      return;
    }

    player.play(typeof clip === "string" ? [clip] : clip);
  };

  const serverNow = () => {
    if (!clockAnchor) {
      return Date.now();
    }

    return (
      clockAnchor.serverTimeAtSync + (now() - clockAnchor.monotonicAtSync)
    );
  };

  const stopCountdown = () => {
    clearInterval(intervalId);
    intervalId = undefined;
    countdown = null;
    phase = null;
  };

  const tick = () => {
    if (!countdown || !phase) {
      return;
    }

    const display = getFcyCountdownDisplay(countdown, serverNow());

    if (!display.visible) {
      return;
    }

    if (!phase.startPlayed) {
      phase.startPlayed = true;
      if (
        display.remainingSeconds >= countdown.countdownSeconds - 1 &&
        display.remainingSeconds > FINAL_COUNTDOWN_FROM
      ) {
        play([`fcy-in-${countdown.countdownSeconds}`, "fcy-starting"]);
      }
    }

    if (
      !display.finished &&
      display.remainingSeconds > FINAL_COUNTDOWN_FROM &&
      display.remainingSeconds < phase.lastMilestone &&
      MILESTONE_SECONDS.includes(display.remainingSeconds)
    ) {
      phase.lastMilestone = display.remainingSeconds;
      play(`fcy-in-${display.remainingSeconds}`);
    }

    if (
      !display.finished &&
      display.remainingSeconds >= 1 &&
      display.remainingSeconds <= FINAL_COUNTDOWN_FROM &&
      display.remainingSeconds < phase.lastNumber
    ) {
      phase.lastNumber = display.remainingSeconds;
      play(String(display.remainingSeconds));
    }

    if (display.finished && !phase.activationPlayed) {
      phase.activationPlayed = true;
      lastSignal = "FCY";
      play("fcy");
      clearInterval(intervalId);
      intervalId = undefined;
    }
  };

  return {
    onState(state) {
      const suppressed = suppressNext;
      suppressNext = false;

      if (state.kind === "fcy-countdown") {
        if (phase && phase.eventId === state.eventId) {
          countdown = state;
          return;
        }

        stopCountdown();
        countdown = state;
        phase = {
          eventId: state.eventId,
          startPlayed: suppressed,
          lastMilestone: state.countdownSeconds,
          lastNumber: FINAL_COUNTDOWN_FROM + 1,
          activationPlayed: false,
        };
        player.prepare(`fcy-in-${state.countdownSeconds}`);

        MILESTONE_SECONDS.filter(
          (milestone) => milestone < state.countdownSeconds,
        ).forEach((milestone) => player.prepare(`fcy-in-${milestone}`));

        intervalId = setInterval(tick, COUNTDOWN_TICK_MS);
        return;
      }

      stopCountdown();

      if (state.signal === lastSignal) {
        return;
      }

      const firstState = lastSignal === null;
      lastSignal = state.signal;

      if (firstState && suppressed) {
        return;
      }

      const clip = SIGNAL_CLIPS[state.signal];

      if (clip) {
        play(clip);
      }
    },
    onStatus(status) {
      if (status.type !== "connected") {
        suppressNext = true;
      }
    },
    onClockSync(clock) {
      clockAnchor = {
        serverTimeAtSync: Date.now() + clock.offsetMs,
        monotonicAtSync: now(),
      };
    },
    setEnabled(next) {
      enabled = next;

      if (!enabled) {
        player.stop();
      }
    },
    isEnabled() {
      return enabled;
    },
    setVolume(volume) {
      player.setVolume(clampVolume(volume));
    },
    dispose() {
      stopCountdown();
      player.dispose();
    },
  };
}
