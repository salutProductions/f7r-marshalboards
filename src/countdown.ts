export type FcyCountdown = {
  eventId: string;
  sequence?: number;
  countdownSeconds: number;
  countdownStartsAt: number;
  fcyAt: number;
};

export type FcyCountdownDisplay = {
  visible: boolean;
  finished: boolean;
  remainingSeconds: number;
};

export function getFcyCountdownDisplay(
  countdown: FcyCountdown,
  serverNow: number,
): FcyCountdownDisplay {
  if (serverNow < countdown.countdownStartsAt) {
    return {
      visible: false,
      finished: false,
      remainingSeconds: countdown.countdownSeconds,
    };
  }

  const remainingMs = countdown.fcyAt - serverNow;

  return {
    visible: true,
    finished: remainingMs <= 0,
    remainingSeconds: Math.max(0, Math.ceil(remainingMs / 1000)),
  };
}
