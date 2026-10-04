function validPosition(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function validRouletteNumber(value) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 && number <= 36 ? number : null;
}

export function buildCycleStageMarker(target, analogue = null) {
  const targetEvents = Array.isArray(target?.events) ? target.events : [];
  const lastTargetEvent = targetEvents.at(-1) ?? null;
  const position = validPosition(lastTargetEvent?.position);
  const number = validRouletteNumber(lastTargetEvent?.number);
  if (position === null || number === null) return null;

  const analogueEvents = Array.isArray(analogue?.events) ? analogue.events : [];
  const referenceEvent = analogueEvents.find(
    (event) => validPosition(event?.position) === position,
  ) ?? null;
  const referenceNumber = validRouletteNumber(referenceEvent?.number);

  return {
    position,
    number,
    active: target?.mode === "active",
    referenceAvailable: referenceEvent !== null && referenceNumber !== null,
    referenceNumber,
    referenceLength: analogueEvents.length,
  };
}
