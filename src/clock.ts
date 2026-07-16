export type ClockSyncSample = {
  offsetMs: number;
  uncertaintyMs: number;
  roundTripMs: number;
};

export function calculateClockSyncSample(
  clientSentAt: number,
  serverReceivedAt: number,
  serverSentAt: number,
  clientReceivedAt: number,
): ClockSyncSample | null {
  if (
    ![
      clientSentAt,
      serverReceivedAt,
      serverSentAt,
      clientReceivedAt,
    ].every(Number.isFinite) ||
    serverSentAt < serverReceivedAt ||
    clientReceivedAt < clientSentAt
  ) {
    return null;
  }

  const serverProcessingMs = serverSentAt - serverReceivedAt;
  const roundTripMs = Math.max(
    0,
    clientReceivedAt - clientSentAt - serverProcessingMs,
  );
  const offsetMs =
    (serverReceivedAt - clientSentAt + serverSentAt - clientReceivedAt) / 2;

  return {
    offsetMs,
    uncertaintyMs: roundTripMs / 2,
    roundTripMs,
  };
}
