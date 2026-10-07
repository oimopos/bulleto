function timestamp(value) {
  if (typeof value !== 'string' || value.trim() === '') return null;
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) return null;
  return {
    iso: new Date(milliseconds).toISOString(),
    milliseconds,
  };
}

export function bettingWindowForApi(collectorState, now = new Date()) {
  if (
    !collectorState ||
    collectorState.connected !== true ||
    collectorState.error != null
  ) {
    return null;
  }

  const round = collectorState.currentRound;
  if (!round || typeof round !== 'object') return null;

  const opensAt = timestamp(round.startsAt);
  const closesAt = timestamp(round.bettingClosesAt ?? round.closesAt);
  const nowMilliseconds = now instanceof Date
    ? now.getTime()
    : Date.parse(now);
  if (!opensAt || !closesAt || !Number.isFinite(nowMilliseconds)) return null;
  if (closesAt.milliseconds <= opensAt.milliseconds) return null;

  const isOpen =
    round.status === 2 &&
    nowMilliseconds >= opensAt.milliseconds &&
    nowMilliseconds < closesAt.milliseconds;

  return {
    roundId: round.id ?? null,
    isOpen,
    opensAt: opensAt.iso,
    closesAt: closesAt.iso,
    secondsUntilClose: isOpen
      ? Math.max(0, Math.ceil((closesAt.milliseconds - nowMilliseconds) / 1_000))
      : null,
  };
}

export function virtualBettingForApi(collectorState, virtualStatus, now = new Date()) {
  const window = bettingWindowForApi(collectorState, now);
  if (!window) return null;

  const strategyReady = virtualStatus === 'armed' || virtualStatus === 'active';
  return {
    ...window,
    strategyReady,
    canBetNow: window.isOpen && strategyReady,
  };
}
