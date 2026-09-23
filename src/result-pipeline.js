function hasExternalRoundId(result) {
  return result.externalRoundId !== null && result.externalRoundId !== undefined;
}

function mergeResult(previous, next) {
  if (!previous) return next;
  const nextHasRoundId = hasExternalRoundId(next);
  return {
    ...previous,
    ...next,
    externalRoundId: nextHasRoundId ? next.externalRoundId : previous.externalRoundId,
    rawPayload: nextHasRoundId ? next.rawPayload : (previous.rawPayload ?? next.rawPayload),
    previousFingerprint: next.previousFingerprint ?? previous.previousFingerprint ?? null,
    snapshotAdjacent: next.snapshotAdjacent ?? previous.snapshotAdjacent ?? false,
  };
}

export class ResultPipeline {
  constructor({
    db,
    source = 'buleto',
    instrument = 'XPM/RUB',
    gapThresholdSeconds = 135,
    logger = console,
  }) {
    if (!db) throw new TypeError('db is required');
    this.db = db;
    this.source = source;
    this.instrument = instrument;
    this.gapThresholdSeconds = gapThresholdSeconds;
    this.logger = logger;
    this.processedFingerprints = new Map();
    this.pendingOperations = [];
    this.pendingGapKeys = new Set();
    this.committedGapKeys = new Map();
  }

  getPendingCounts() {
    return {
      results: this.pendingOperations.reduce(
        (total, operation) => total + (operation.type === 'results' ? operation.results.size : 0),
        0,
      ),
      gaps: this.pendingOperations.filter((operation) => operation.type === 'gap').length,
    };
  }

  #rememberGap(key) {
    this.committedGapKeys.delete(key);
    this.committedGapKeys.set(key, true);
    while (this.committedGapKeys.size > 2_048) {
      this.committedGapKeys.delete(this.committedGapKeys.keys().next().value);
    }
  }

  #gapKey(details) {
    return [
      details.reason ?? 'gap',
      details.detectedAt ?? '',
      details.from ?? '',
      details.to ?? '',
      details.message ?? '',
    ].join('\u0000');
  }

  enqueueIntegrityGap(details = {}) {
    if (!details || typeof details !== 'object' || Array.isArray(details)) {
      throw new TypeError('gap details must be an object');
    }

    const normalized = {
      ...details,
      source: this.source,
      instrument: this.instrument,
      detectedAt: details.detectedAt ?? new Date().toISOString(),
    };
    const key = this.#gapKey(normalized);
    normalized.incidentKey ??= `collector\u0000${key}`;
    let queued = false;
    if (!this.pendingGapKeys.has(key) && !this.committedGapKeys.has(key)) {
      this.pendingOperations.push({ type: 'gap', key, details: normalized });
      this.pendingGapKeys.add(key);
      queued = true;
    }
    return { queued, pending: this.getPendingCounts() };
  }

  queueIntegrityGap(details = {}) {
    this.enqueueIntegrityGap(details);
    return this.drain();
  }

  #resultMap(results) {
    const mapped = new Map();
    for (const result of results) {
      if (!result || typeof result !== 'object' || Array.isArray(result)) {
        throw new TypeError('each result must be an object');
      }
      if (typeof result.fingerprint !== 'string' || result.fingerprint === '') {
        throw new TypeError('result fingerprint must be a non-empty string');
      }
      if (typeof result.settledAt !== 'string' || !Number.isFinite(Date.parse(result.settledAt))) {
        throw new TypeError(`Некорректное время результата: ${String(result.settledAt)}`);
      }
      mapped.set(result.fingerprint, mergeResult(mapped.get(result.fingerprint), result));
    }
    return mapped;
  }

  #candidates(results) {
    const candidates = [];
    for (const result of results.values()) {
      const seen = this.processedFingerprints.get(result.fingerprint);
      if (!seen || (hasExternalRoundId(result) && !seen.hasExternalRoundId)) {
        candidates.push(result);
      }
    }
    return candidates.sort((left, right) => left.settledAt.localeCompare(right.settledAt));
  }

  #remember(results) {
    for (const result of results) {
      const previous = this.processedFingerprints.get(result.fingerprint);
      this.processedFingerprints.delete(result.fingerprint);
      this.processedFingerprints.set(result.fingerprint, {
        hasExternalRoundId: previous?.hasExternalRoundId || hasExternalRoundId(result),
      });
    }

    while (this.processedFingerprints.size > 2_048) {
      this.processedFingerprints.delete(this.processedFingerprints.keys().next().value);
    }
  }

  ingest(results) {
    if (!Array.isArray(results)) throw new TypeError('results must be an array');
    const mapped = this.#resultMap(results);
    if (mapped.size > 0) {
      const tail = this.pendingOperations.at(-1);
      if (tail?.type === 'results') {
        for (const [fingerprint, result] of mapped) {
          tail.results.set(fingerprint, mergeResult(tail.results.get(fingerprint), result));
        }
      } else {
        this.pendingOperations.push({ type: 'results', results: mapped });
      }
    }
    return this.drain();
  }

  drain() {
    const aggregate = { inserted: 0, gaps: 0, ignoredHistorical: 0, changed: false };

    // Operations preserve EventEmitter order. In particular, a failed result
    // batch must finish before a later gap, and a failed gap must commit before
    // the terminal result batch that follows it.
    while (this.pendingOperations.length > 0) {
      const operation = this.pendingOperations[0];
      if (operation.type === 'gap') {
        const following = this.pendingOperations[1];
        if (following?.type === 'results') {
          const outcome = this.#processResults(following.results, operation);
          this.pendingOperations.splice(0, 2);
          this.pendingGapKeys.delete(operation.key);
          aggregate.inserted += outcome.inserted;
          aggregate.gaps += outcome.gaps;
          aggregate.ignoredHistorical += outcome.ignoredHistorical;
          aggregate.changed ||= outcome.changed;
          continue;
        }

        this.db.markGap(operation.details);
        this.pendingOperations.shift();
        this.pendingGapKeys.delete(operation.key);
        this.#rememberGap(operation.key);
        aggregate.gaps += 1;
        aggregate.changed = true;
        continue;
      }

      const outcome = this.#processResults(operation.results);
      this.pendingOperations.shift();
      aggregate.inserted += outcome.inserted;
      aggregate.gaps += outcome.gaps;
      aggregate.ignoredHistorical += outcome.ignoredHistorical;
      aggregate.changed ||= outcome.changed;
    }

    return aggregate;
  }

  #processResults(results, leadingGap = null) {
    const candidates = this.#candidates(results);
    if (candidates.length === 0) {
      if (leadingGap && !this.committedGapKeys.has(leadingGap.key)) {
        const gapOutcome =
          typeof this.db.ingestBatchAfterGap === 'function'
            ? this.db.ingestBatchAfterGap(leadingGap.details, []).gap
            : this.db.markGap(leadingGap.details);
        this.#rememberGap(leadingGap.key);
        return {
          inserted: 0,
          gaps: gapOutcome?.duplicate ? 0 : 1,
          ignoredHistorical: 0,
          changed: !gapOutcome?.duplicate,
        };
      }
      return { inserted: 0, gaps: 0, ignoredHistorical: 0, changed: false };
    }

    const previous =
      typeof this.db.getLatestResult === 'function'
        ? this.db.getLatestResult(this.source, this.instrument)
        : this.db.getDashboardState().latestResult;
    let cursorTime = previous ? new Date(previous.settledAt).getTime() : null;
    let cursorTimestamp = previous?.settledAt ?? null;
    let cursorFingerprint = previous?.fingerprint ?? null;
    let cursorRoundId =
      previous?.externalRoundId == null ? null : Number(previous.externalRoundId);
    if (cursorRoundId !== null && !Number.isSafeInteger(cursorRoundId)) cursorRoundId = null;
    const storedCoverageLatestTime = cursorTime;

    let segment = [];
    let inserted = 0;
    let gaps = 0;
    let changed = false;
    const historical = [];
    let historicalCommitted = false;
    const hasAuthoritativeLeadingGap =
      leadingGap !== null && !this.committedGapKeys.has(leadingGap.key);
    let segmentGap = hasAuthoritativeLeadingGap ? leadingGap : null;
    let leadingBoundaryPending = hasAuthoritativeLeadingGap;

    const flushSegment = () => {
      const historicalForCommit = historicalCommitted ? [] : historical;
      if (
        segment.length === 0 &&
        segmentGap === null &&
        historicalForCommit.length === 0
      ) {
        return;
      }
      let outcome;
      let gapOutcome = null;
      if (segmentGap && typeof this.db.ingestBatchAfterGap === 'function') {
        outcome = this.db.ingestBatchAfterGap(segmentGap.details, segment, {
          historicalEvents: historicalForCommit,
        });
        gapOutcome = outcome.gap;
      } else {
        if (segmentGap) gapOutcome = this.db.markGap(segmentGap.details);
        outcome = this.db.ingestBatch(segment, {
          historicalEvents: historicalForCommit,
        });
        gapOutcome ??= outcome?.gap ?? null;
      }
      this.#remember([...historicalForCommit, ...segment]);
      historicalCommitted = true;
      inserted += outcome?.inserted ?? outcome?.insertedCount ?? outcome?.length ?? 0;
      if (segmentGap) {
        this.#rememberGap(segmentGap.key);
        if (!gapOutcome?.duplicate) gaps += 1;
      } else if (gapOutcome && !gapOutcome.duplicate) {
        gaps += 1;
      }
      changed ||=
        segment.length > 0 ||
        (outcome?.historical?.enriched ?? 0) > 0 ||
        (gapOutcome !== null && !gapOutcome?.duplicate);
      segment = [];
      segmentGap = null;
    };

    for (const result of candidates) {
      const resultTime = new Date(result.settledAt).getTime();
      if (!Number.isFinite(resultTime)) {
        throw new TypeError(`Некорректное время результата: ${String(result.settledAt)}`);
      }

      // Never append an old event to the end of a derived cycle. The database
      // atomically distinguishes known/bootstrap history from a missing row
      // inside the current continuity coverage before forward rows are saved.
      if (
        storedCoverageLatestTime !== null &&
        resultTime <= storedCoverageLatestTime
      ) {
        historical.push(result);
        continue;
      }

      const suppressAutomaticGap = leadingBoundaryPending;
      leadingBoundaryPending = false;
      if (cursorTime !== null && resultTime > cursorTime && !suppressAutomaticGap) {
        const gapSeconds = (resultTime - cursorTime) / 1_000;
        const snapshotProvesAdjacency =
          result.snapshotAdjacent === true &&
          result.previousFingerprint &&
          result.previousFingerprint === cursorFingerprint;
        const resultRoundId =
          result.externalRoundId == null ? null : Number(result.externalRoundId);
        const roundIdProvesAdjacency =
          cursorRoundId !== null &&
          resultRoundId !== null &&
          Number.isSafeInteger(resultRoundId) &&
          resultRoundId === cursorRoundId + 1;

        if (
          gapSeconds > this.gapThresholdSeconds &&
          !snapshotProvesAdjacency &&
          !roundIdProvesAdjacency
        ) {
          if (segment.length > 0 || segmentGap !== null) flushSegment();
          const automaticGap = {
            source: this.source,
            instrument: this.instrument,
            from: cursorTimestamp,
            to: result.settledAt,
            gapSeconds,
            detectedAt: new Date().toISOString(),
            message: `В потоке результатов обнаружен интервал ${Math.round(gapSeconds)} сек.`,
          };
          // If the following batch commit fails, retrying must not create a
          // duplicate incident or invalidate the fresh cycle a second time.
          const key = `automatic\u0000${cursorFingerprint ?? ''}\u0000${result.fingerprint}`;
          if (!this.committedGapKeys.has(key)) {
            automaticGap.incidentKey = key;
            segmentGap = { type: 'gap', key, details: automaticGap };
          }
        }
      }

      segment.push(result);
      if (cursorTime === null || resultTime > cursorTime) {
        cursorTime = resultTime;
        cursorTimestamp = result.settledAt;
        cursorFingerprint = result.fingerprint;
        const externalRoundId =
          result.externalRoundId == null ? null : Number(result.externalRoundId);
        cursorRoundId =
          externalRoundId !== null && Number.isSafeInteger(externalRoundId)
            ? externalRoundId
            : null;
      } else if (resultTime === cursorTime && result.externalRoundId != null) {
        const externalRoundId = Number(result.externalRoundId);
        if (Number.isSafeInteger(externalRoundId)) cursorRoundId = externalRoundId;
      }
    }

    flushSegment();
    if (historical.length > 0) {
      this.logger.warn?.(`[collector] ignored ${historical.length} late historical result(s)`);
    }

    return {
      inserted,
      gaps,
      ignoredHistorical: historical.length,
      changed,
    };
  }
}
