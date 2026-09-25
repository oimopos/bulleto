import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import {
  PRECLOSE_FORECAST_MAX_LEAD_MS,
  PRECLOSE_FORECAST_MIN_LEAD_MS,
  buildPrecloseForecast,
} from './preclose-forecast.js';

const DEFAULT_SOURCE = 'buleto';
const DEFAULT_INSTRUMENT = 'XPM/RUB';

export function canonicalRouletteNumber(value) {
  if (
    (typeof value !== 'number' && typeof value !== 'string') ||
    (typeof value === 'string' && value.trim() === '')
  ) {
    throw new TypeError(`Число рулетки должно быть числом: ${String(value)}`);
  }
  const number = Number(value);

  // Buleto обозначает европейский 0 ячейкой 37 в wire-протоколе.
  if (number === 37) return 0;
  if (Number.isInteger(number) && number >= 0 && number <= 36) return number;

  throw new RangeError(`Недопустимое число рулетки: ${String(value)}`);
}

export function normalizeWireResult(
  row,
  {
    source = DEFAULT_SOURCE,
    instrument = DEFAULT_INSTRUMENT,
    observedAt = new Date(),
    externalRoundId = null,
  } = {},
) {
  if (!row || typeof row !== 'object') {
    throw new TypeError('Результат Buleto должен быть объектом');
  }

  if (typeof row.dt !== 'string' || row.dt.trim() === '') {
    throw new TypeError(`Некорректное время результата: ${String(row.dt)}`);
  }
  const settledDate = new Date(row.dt);
  if (Number.isNaN(settledDate.getTime())) {
    throw new TypeError(`Некорректное время результата: ${String(row.dt)}`);
  }

  const resultNumber = canonicalRouletteNumber(row.c);
  if (
    (typeof row.v !== 'number' && typeof row.v !== 'string') ||
    (typeof row.v === 'string' && row.v.trim() === '')
  ) {
    throw new TypeError(`Некорректная цена результата: ${String(row.v)}`);
  }
  const numericPrice = Number(row.v);
  if (!Number.isFinite(numericPrice)) {
    throw new TypeError(`Некорректная цена результата: ${String(row.v)}`);
  }

  // round.rr иногда содержит доли секунды, а тот же элемент в последующем
  // last-results округлён до целой секунды. Раунды идут раз в ~90 секунд,
  // поэтому нормализация до секунды безопасна и не создаёт двойную запись.
  settledDate.setUTCMilliseconds(0);
  const settledAt = settledDate.toISOString();
  const observedDate = observedAt instanceof Date ? observedAt : new Date(observedAt);
  if (Number.isNaN(observedDate.getTime())) {
    throw new TypeError(`Некорректное время наблюдения: ${String(observedAt)}`);
  }

  // Одинаковая цена может прийти как 5.4 и "5.40000". Каноническая
  // строка не даёт этим представлениям создать два fingerprint.
  const price = String(numericPrice);
  const fingerprint = createHash('sha256')
    .update(`${source}\u0000${instrument}\u0000${settledAt}\u0000${resultNumber}\u0000${price}`)
    .digest('hex');

  return {
    source,
    instrument,
    externalRoundId,
    settledAt,
    resultNumber,
    price,
    observedAt: observedDate.toISOString(),
    fingerprint,
    rawPayload: row,
  };
}

export function normalizeLastResults(rows, options = {}) {
  if (!Array.isArray(rows)) {
    throw new TypeError('last-results.data должен быть массивом');
  }

  const observedAt = options.observedAt ?? new Date();
  const normalized = rows
    .map((row) => normalizeWireResult(row, { ...options, observedAt }))
    .sort((left, right) => left.settledAt.localeCompare(right.settledAt));
  return normalized.map((result, index) => ({
    ...result,
    previousFingerprint: index > 0 ? normalized[index - 1].fingerprint : null,
    snapshotAdjacent: index > 0,
  }));
}

export class BuletoCollector extends EventEmitter {
  constructor({
    url = 'wss://buleto.com/ws',
    source = DEFAULT_SOURCE,
    instrument = DEFAULT_INSTRUMENT,
    reconnectMinMs = 1_000,
    reconnectMaxMs = 30_000,
    staleAfterMs = 180_000,
    connectionTimeoutMs = 20_000,
    initialSnapshotTimeoutMs = 30_000,
    resultSnapshotTimeoutMs = 15_000,
    maxUnmatchedSnapshots = 5,
    logger = console,
  } = {}) {
    super();
    this.url = url;
    this.source = source;
    this.instrument = instrument;
    this.reconnectMinMs = reconnectMinMs;
    this.reconnectMaxMs = reconnectMaxMs;
    this.staleAfterMs = staleAfterMs;
    this.connectionTimeoutMs = connectionTimeoutMs;
    this.initialSnapshotTimeoutMs = initialSnapshotTimeoutMs;
    this.resultSnapshotTimeoutMs = resultSnapshotTimeoutMs;
    this.maxUnmatchedSnapshots = maxUnmatchedSnapshots;
    this.logger = logger;

    this.socket = null;
    this.reconnectTimer = null;
    this.watchdogTimer = null;
    this.connectionTimer = null;
    this.initialSnapshotTimer = null;
    this.resultSnapshotTimer = null;
    this.initialSnapshotReceived = false;
    this.pendingRoundResults = [];
    this.deferredSnapshotResults = new Map();
    this.missingSnapshotAttempts = 0;
    this.unmatchedSnapshotCount = 0;
    this.snapshotFailureCounted = false;
    this.forecastRound = null;
    this.latestFactors = [];
    this.forecastErrorRoundId = null;
    this.stopped = true;
    this.generation = 0;
    this.retryAttempt = 0;
    this.state = {
      status: 'stopped',
      connected: false,
      lastMessageAt: null,
      lastResultAt: null,
      retryCount: 0,
      error: null,
      currentRound: null,
    };
  }

  getStatus() {
    return structuredClone(this.state);
  }

  start() {
    if (!this.stopped) return;
    this.stopped = false;
    this.pendingRoundResults = [];
    this.deferredSnapshotResults = new Map();
    this.missingSnapshotAttempts = 0;
    this.unmatchedSnapshotCount = 0;
    this.forecastRound = null;
    this.latestFactors = [];
    this.forecastErrorRoundId = null;
    this.generation += 1;
    this.#connect(this.generation);
    this.watchdogTimer = setInterval(() => this.#watchdog(), 15_000);
    this.watchdogTimer.unref?.();
  }

  flushPendingForShutdown() {
    const hasDeferredSnapshot = this.deferredSnapshotResults.size > 0;
    if (this.pendingRoundResults.length === 0 && !hasDeferredSnapshot) {
      return { flushed: 0, markedGap: false };
    }

    const flushed = new Set([
      ...this.pendingRoundResults.map((result) => result.fingerprint),
      ...this.deferredSnapshotResults.keys(),
    ]).size;
    // A final round message already carries the stable round id and result.
    // Persist it before a planned shutdown; a restart snapshot will dedupe or
    // enrich the same row. A controlled deploy is not evidence of a data gap.
    this.#flushPendingRoundResults();
    return { flushed, markedGap: false };
  }

  stop() {
    if (this.stopped) return;
    this.stopped = true;
    this.generation += 1;
    clearTimeout(this.reconnectTimer);
    clearTimeout(this.connectionTimer);
    clearTimeout(this.initialSnapshotTimer);
    clearTimeout(this.resultSnapshotTimer);
    clearInterval(this.watchdogTimer);
    this.reconnectTimer = null;
    this.connectionTimer = null;
    this.initialSnapshotTimer = null;
    this.resultSnapshotTimer = null;
    this.watchdogTimer = null;

    const socket = this.socket;
    this.socket = null;
    if (socket && socket.readyState < WebSocket.CLOSING) {
      socket.close(1000, 'collector stopped');
    }

    this.#setState({ status: 'stopped', connected: false });
  }

  #connect(generation) {
    if (this.stopped || generation !== this.generation) return;

    clearTimeout(this.initialSnapshotTimer);
    clearTimeout(this.resultSnapshotTimer);
    clearTimeout(this.connectionTimer);
    this.initialSnapshotTimer = null;
    this.resultSnapshotTimer = null;
    this.connectionTimer = null;
    this.initialSnapshotReceived = false;
    this.snapshotFailureCounted = false;
    this.forecastRound = null;
    this.latestFactors = [];
    this.forecastErrorRoundId = null;

    this.#setState({
      status: this.retryAttempt === 0 ? 'connecting' : 'reconnecting',
      connected: false,
      retryCount: this.retryAttempt,
      lastMessageAt: null,
      currentRound: null,
    });

    let socket;
    try {
      socket = new WebSocket(this.url);
    } catch (error) {
      this.#handleFailure(error, generation);
      return;
    }

    this.socket = socket;
    this.connectionTimer = setTimeout(() => {
      if (
        this.stopped ||
        generation !== this.generation ||
        socket !== this.socket ||
        socket.readyState !== WebSocket.CONNECTING
      ) {
        return;
      }
      this.#recordSnapshotFailure();
      this.socket = null;
      try {
        socket.close();
      } catch {
        // The stale socket is detached below even if close itself fails.
      }
      this.#scheduleReconnect('Тайм-аут подключения к Buleto', generation);
    }, this.connectionTimeoutMs);
    this.connectionTimer.unref?.();

    socket.addEventListener('open', () => {
      if (this.stopped || generation !== this.generation || socket !== this.socket) {
        socket.close();
        return;
      }

      clearTimeout(this.connectionTimer);
      this.connectionTimer = null;
      this.#setState({
        status: 'connected',
        connected: true,
        retryCount: this.retryAttempt,
        error: null,
      });
      // На живом endpoint initial snapshot может идти 15+ секунд. До него
      // round.rr держим в памяти, чтобы старые snapshot-записи не попали в
      // цикл после более нового результата.
      this.initialSnapshotTimer = setTimeout(() => {
        this.initialSnapshotTimer = null;
        this.#handleMissingInitialSnapshot(socket, generation);
      }, this.initialSnapshotTimeoutMs);
      this.initialSnapshotTimer.unref?.();
      this.logger.info?.(`[collector] connected to ${this.url}`);
    });

    socket.addEventListener('message', (event) => {
      if (this.stopped || generation !== this.generation || socket !== this.socket) return;
      this.#handleMessage(event.data);
    });

    socket.addEventListener('error', () => {
      if (this.stopped || generation !== this.generation || socket !== this.socket) return;
      this.#setState({ error: 'Ошибка WebSocket-соединения с Buleto' });
      if (socket.readyState === WebSocket.OPEN) {
        socket.close(4002, 'websocket error');
      }
    });

    socket.addEventListener('close', (event) => {
      if (generation !== this.generation || socket !== this.socket) return;
      this.socket = null;
      clearTimeout(this.connectionTimer);
      this.connectionTimer = null;
      clearTimeout(this.initialSnapshotTimer);
      this.initialSnapshotTimer = null;
      clearTimeout(this.resultSnapshotTimer);
      this.resultSnapshotTimer = null;
      if (!this.initialSnapshotReceived) this.#recordSnapshotFailure();
      if (this.stopped) return;

      const reason = event.reason || `WebSocket закрыт (код ${event.code})`;
      this.#scheduleReconnect(reason, generation);
    });
  }

  #handleMessage(rawData) {
    const receivedAt = new Date();
    this.state.lastMessageAt = receivedAt.toISOString();

    let message;
    try {
      message = JSON.parse(String(rawData));
    } catch (error) {
      this.emit('collector-error', new Error('Buleto прислал невалидный JSON', { cause: error }));
      return;
    }

    if (!message || typeof message !== 'object') return;

    if (message.type === 'last-results') {
      try {
        const snapshotResults = normalizeLastResults(message.data, {
          source: this.source,
          instrument: this.instrument,
          observedAt: receivedAt,
        });
        clearTimeout(this.initialSnapshotTimer);
        this.initialSnapshotTimer = null;
        this.initialSnapshotReceived = true;
        this.missingSnapshotAttempts = 0;
        this.snapshotFailureCounted = false;
        this.retryAttempt = 0;
        if (this.state.retryCount !== 0) this.#setState({ retryCount: 0, error: null });

        // round.rr может прийти раньше обновлённого snapshot. Обогащаем
        // snapshot round id только после совпадения fingerprint; будущий rr
        // остаётся в pending до следующего last-results.
        for (const result of snapshotResults) {
          this.deferredSnapshotResults.set(result.fingerprint, result);
        }
        const stillPending = [];
        for (const pending of this.pendingRoundResults) {
          const snapshotMatch = this.deferredSnapshotResults.get(pending.fingerprint);
          if (!snapshotMatch) {
            stillPending.push(pending);
            continue;
          }
          this.deferredSnapshotResults.set(pending.fingerprint, {
            ...pending,
            previousFingerprint: snapshotMatch.previousFingerprint,
            snapshotAdjacent: snapshotMatch.snapshotAdjacent,
          });
        }
        this.pendingRoundResults = stillPending;
        if (stillPending.length === 0) {
          this.unmatchedSnapshotCount = 0;
          clearTimeout(this.resultSnapshotTimer);
          this.resultSnapshotTimer = null;
        } else {
          this.unmatchedSnapshotCount += 1;
          if (this.unmatchedSnapshotCount >= this.maxUnmatchedSnapshots) {
            clearTimeout(this.resultSnapshotTimer);
            this.resultSnapshotTimer = null;
            this.emit('integrity-gap', {
              reason: 'round-result-not-confirmed-by-snapshot',
              detectedAt: new Date().toISOString(),
              message:
                'Результат round не появился в нескольких снимках истории; цикл перезапущен.',
            });
            for (const pending of stillPending) {
              if (!this.deferredSnapshotResults.has(pending.fingerprint)) {
                this.deferredSnapshotResults.set(pending.fingerprint, pending);
              }
            }
            this.pendingRoundResults = [];
            this.unmatchedSnapshotCount = 0;
          } else {
            this.#armResultSnapshotTimer();
            return;
          }
        }
        const chronological = [...this.deferredSnapshotResults.values()]
          .sort((a, b) => a.settledAt.localeCompare(b.settledAt));
        this.deferredSnapshotResults.clear();
        this.#emitResults(chronological);
      } catch (error) {
        this.emit('collector-error', error);
      }
      return;
    }

    if (message.type === 'factors') {
      if (Array.isArray(message.data)) {
        this.latestFactors = message.data;
        this.#tryEmitPrecloseForecast(receivedAt);
      }
      return;
    }

    if (message.type === 'round' && message.data && typeof message.data === 'object') {
      this.state.currentRound = {
        id: message.data.id ?? null,
        status: message.data.s ?? null,
        startsAt: message.data.sd ?? null,
        bettingClosesAt: message.data.bcd ?? null,
        closesAt: message.data.bcd ?? null,
        bettingStopsAt: message.data.btd ?? null,
        endsAt: message.data.ed ?? null,
      };
      this.emit('round', structuredClone(this.state.currentRound));

      if (!('rr' in message.data) && message.data.s === 2) {
        this.forecastRound = message.data;
        this.#tryEmitPrecloseForecast(receivedAt);
      } else {
        this.forecastRound = null;
      }

      // В финальном сообщении round поле rr содержит тот же результат, что
      // позже попадёт в last-results, но здесь доступен стабильный id раунда.
      if (message.data.rr) {
        try {
          const result = normalizeWireResult(message.data.rr, {
            source: this.source,
            instrument: this.instrument,
            observedAt: receivedAt,
            externalRoundId: message.data.id ?? null,
          });
          result.rawPayload = message.data;
          const pendingIndex = this.pendingRoundResults.findIndex(
            (pending) => pending.fingerprint === result.fingerprint,
          );
          if (pendingIndex >= 0) this.pendingRoundResults[pendingIndex] = result;
          else this.pendingRoundResults.push(result);
          if (this.initialSnapshotReceived) this.#armResultSnapshotTimer();
        } catch (error) {
          this.emit('collector-error', error);
        }
      }
    }
  }

  #tryEmitPrecloseForecast(receivedAt) {
    if (!this.forecastRound || this.latestFactors.length === 0) return;
    const closesAtMs = Date.parse(this.forecastRound.bcd);
    const receivedAtMs = receivedAt.getTime();
    const leadTimeMs = closesAtMs - receivedAtMs;
    if (
      !Number.isFinite(leadTimeMs) ||
      leadTimeMs < PRECLOSE_FORECAST_MIN_LEAD_MS ||
      leadTimeMs > PRECLOSE_FORECAST_MAX_LEAD_MS
    ) {
      return;
    }

    try {
      const forecast = buildPrecloseForecast({
        round: this.forecastRound,
        factors: this.latestFactors,
        receivedAt,
      });
      this.forecastErrorRoundId = null;
      this.emit('preclose-forecast', {
        source: this.source,
        instrument: this.instrument,
        ...forecast,
      });
    } catch (error) {
      const roundId = String(this.forecastRound.id ?? 'unknown');
      if (this.forecastErrorRoundId === roundId) return;
      this.forecastErrorRoundId = roundId;
      this.emit(
        'collector-error',
        new Error(`Не удалось зафиксировать прогноз раунда ${roundId}`, { cause: error }),
      );
    }
  }

  #emitResults(results) {
    if (results.length === 0) return;
    this.state.lastResultAt = [this.state.lastResultAt, ...results.map((result) => result.settledAt)]
      .filter(Boolean)
      .sort()
      .at(-1);
    this.emit('results', results);
  }

  #flushPendingRoundResults() {
    if (this.pendingRoundResults.length === 0 && this.deferredSnapshotResults.size === 0) return;
    clearTimeout(this.resultSnapshotTimer);
    this.resultSnapshotTimer = null;
    for (const pending of this.pendingRoundResults.splice(0)) {
      this.deferredSnapshotResults.set(pending.fingerprint, pending);
    }
    const results = [...this.deferredSnapshotResults.values()].sort((left, right) =>
      left.settledAt.localeCompare(right.settledAt),
    );
    this.deferredSnapshotResults.clear();
    this.unmatchedSnapshotCount = 0;
    this.#emitResults(results);
  }

  #armResultSnapshotTimer() {
    if (
      this.resultSnapshotTimer ||
      this.pendingRoundResults.length === 0 ||
      !this.initialSnapshotReceived
    ) {
      return;
    }
    const socket = this.socket;
    const generation = this.generation;
    this.resultSnapshotTimer = setTimeout(() => {
      this.resultSnapshotTimer = null;
      if (
        this.stopped ||
        generation !== this.generation ||
        socket !== this.socket ||
        this.pendingRoundResults.length === 0
      ) {
        return;
      }
      // Не выпускаем неподтверждённый rr поверх старого цикла. Новый
      // handshake запросит initial snapshot, pending сохраняется.
      this.initialSnapshotReceived = false;
      socket.close(4004, 'result snapshot timeout');
    }, this.resultSnapshotTimeoutMs);
    this.resultSnapshotTimer.unref?.();
  }

  #handleMissingInitialSnapshot(socket, generation) {
    if (
      this.stopped ||
      generation !== this.generation ||
      socket !== this.socket ||
      this.initialSnapshotReceived
    ) {
      return;
    }

    const reachedFallback = this.#recordSnapshotFailure();
    const error = new Error(
      `Buleto не прислал initial last-results за ${this.initialSnapshotTimeoutMs / 1000} сек.`,
    );
    this.emit('collector-error', error);

    if (!reachedFallback) {
      socket.close(4001, 'initial snapshot timeout');
    }
  }

  #recordSnapshotFailure() {
    if (this.snapshotFailureCounted) return this.initialSnapshotReceived;
    this.snapshotFailureCounted = true;
    this.missingSnapshotAttempts += 1;
    if (this.missingSnapshotAttempts < 3) return false;
    this.#fallbackWithoutSnapshot();
    return true;
  }

  #fallbackWithoutSnapshot() {
    // После трёх безуспешных подключений продолжаем только с достоверными
    // round.rr, помечая границу как gap. Серверный commit-cache и проверка
    // времени не дадут позднему snapshot изменить уже рассчитанный цикл.
    this.initialSnapshotReceived = true;
    this.missingSnapshotAttempts = 0;
    this.emit('integrity-gap', {
      reason: 'missing-initial-snapshot',
      detectedAt: new Date().toISOString(),
      message: 'Buleto трижды не прислал начальную историю; цикл перезапущен.',
    });
    this.#flushPendingRoundResults();
  }

  #watchdog() {
    if (this.stopped || !this.socket || !this.state.connected || !this.state.lastMessageAt) return;
    const silenceMs = Date.now() - new Date(this.state.lastMessageAt).getTime();
    if (silenceMs > this.staleAfterMs) {
      this.#setState({ error: `Нет сообщений Buleto ${Math.round(silenceMs / 1000)} сек.` });
      this.socket.close(4000, 'stale connection');
      return;
    }

    if (!this.initialSnapshotReceived || !this.state.lastResultAt) return;
    const resultSilenceMs = Date.now() - new Date(this.state.lastResultAt).getTime();
    if (resultSilenceMs > this.staleAfterMs) {
      this.#setState({
        error: `Нет новых результатов Buleto ${Math.round(resultSilenceMs / 1000)} сек.`,
      });
      this.socket.close(4003, 'stale result stream');
    }
  }

  #handleFailure(error, generation) {
    this.#recordSnapshotFailure();
    this.emit('collector-error', error);
    this.#scheduleReconnect(error?.message || String(error), generation);
  }

  #scheduleReconnect(reason, generation) {
    if (this.stopped || generation !== this.generation || this.reconnectTimer) return;

    this.retryAttempt += 1;
    const exponentialDelay = Math.min(
      this.reconnectMaxMs,
      this.reconnectMinMs * 2 ** Math.min(this.retryAttempt - 1, 10),
    );
    const delay = Math.round(exponentialDelay * (0.8 + Math.random() * 0.4));

    this.#setState({
      status: 'reconnecting',
      connected: false,
      retryCount: this.retryAttempt,
      error: reason,
    });

    this.logger.warn?.(`[collector] ${reason}; reconnect in ${delay} ms`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.#connect(generation);
    }, delay);
    this.reconnectTimer.unref?.();
  }

  #setState(patch) {
    this.state = { ...this.state, ...patch };
    this.emit('status', this.getStatus());
  }
}
