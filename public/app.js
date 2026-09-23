import { BET_RISK_MODEL, calculateBetRisk } from "./risk-calculator.js?v=2";

(() => {
  "use strict";

  const RED_NUMBERS = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
  const ALL_NUMBERS = Array.from({ length: 37 }, (_, number) => number);
  const REFRESH_INTERVAL_MS = 45_000;
  const AGE_UPDATE_INTERVAL_MS = 30_000;

  const elements = {
    main: document.querySelector("main"),
    connection: document.getElementById("connection-status"),
    connectionLabel: document.getElementById("connection-label"),
    refreshButton: document.getElementById("refresh-button"),
    collectorCard: document.getElementById("collector-card"),
    collectorStatus: document.getElementById("collector-status"),
    gapAlert: document.getElementById("gap-alert"),
    gapMessage: document.getElementById("gap-message"),
    lastNumber: document.getElementById("last-number"),
    lastTime: document.getElementById("last-time"),
    lastPrice: document.getElementById("last-price"),
    lastRound: document.getElementById("last-round"),
    cycleId: document.getElementById("cycle-id"),
    progressRing: document.getElementById("progress-ring"),
    progressValue: document.getElementById("progress-value"),
    cycleProgress: document.getElementById("cycle-progress"),
    remainingCount: document.getElementById("remaining-count"),
    remainingLabel: document.getElementById("remaining-label"),
    drawCount: document.getElementById("draw-count"),
    repeatCount: document.getElementById("repeat-count"),
    cycleStart: document.getElementById("cycle-start"),
    numberGrid: document.getElementById("number-grid"),
    boardNote: document.getElementById("board-note"),
    overdueList: document.getElementById("overdue-list"),
    triplesList: document.getElementById("triples-list"),
    triplesCount: document.getElementById("triples-count"),
    triplesToggle: document.getElementById("triples-toggle"),
    resultsBody: document.getElementById("results-body"),
    resultsCount: document.getElementById("results-count"),
    cyclesList: document.getElementById("cycles-list"),
    cyclesCount: document.getElementById("cycles-count"),
    virtualPanel: document.getElementById("virtual-panel"),
    virtualStatusBadge: document.getElementById("virtual-status-badge"),
    virtualStatusTitle: document.getElementById("virtual-status-title"),
    virtualStatusCopy: document.getElementById("virtual-status-copy"),
    virtualBank: document.getElementById("virtual-bank"),
    virtualBankStatus: document.getElementById("virtual-bank-status"),
    virtualBankInitial: document.getElementById("virtual-bank-initial"),
    virtualBankCurrentCard: document.getElementById("virtual-bank-current-card"),
    virtualBankCurrent: document.getElementById("virtual-bank-current"),
    virtualBankPnlCard: document.getElementById("virtual-bank-pnl-card"),
    virtualBankPnl: document.getElementById("virtual-bank-pnl"),
    virtualBankNextCard: document.getElementById("virtual-bank-next-card"),
    virtualBankNext: document.getElementById("virtual-bank-next"),
    virtualBankNextState: document.getElementById("virtual-bank-next-state"),
    virtualBankStartedAt: document.getElementById("virtual-bank-started-at"),
    virtualBankExhaustedWrap: document.getElementById("virtual-bank-exhausted-wrap"),
    virtualBankExhaustedAt: document.getElementById("virtual-bank-exhausted-at"),
    virtualBankMessage: document.getElementById("virtual-bank-message"),
    virtualProgressLabel: document.getElementById("virtual-progress-label"),
    virtualProgressValue: document.getElementById("virtual-progress-value"),
    virtualProgress: document.getElementById("virtual-progress"),
    virtualCandidate: document.getElementById("virtual-candidate"),
    virtualCandidateNumber: document.getElementById("virtual-candidate-number"),
    virtualCandidateTitle: document.getElementById("virtual-candidate-title"),
    virtualCandidateMeta: document.getElementById("virtual-candidate-meta"),
    virtualModelSummary: document.getElementById("virtual-model-summary"),
    virtualSession: document.getElementById("virtual-session"),
    virtualTargetNumber: document.getElementById("virtual-target-number"),
    virtualSessionTitle: document.getElementById("virtual-session-title"),
    virtualTargetSummary: document.getElementById("virtual-target-summary"),
    virtualTriggerRounds: document.getElementById("virtual-trigger-rounds"),
    virtualSelectedAt: document.getElementById("virtual-selected-at"),
    virtualStartedAt: document.getElementById("virtual-started-at"),
    virtualAttemptCount: document.getElementById("virtual-attempt-count"),
    virtualMissCount: document.getElementById("virtual-miss-count"),
    virtualTotalStaked: document.getElementById("virtual-total-staked"),
    virtualNextStake: document.getElementById("virtual-next-stake"),
    virtualProjectedGross: document.getElementById("virtual-projected-gross"),
    virtualProjectedNetCard: document.getElementById("virtual-projected-net-card"),
    virtualProjectedNet: document.getElementById("virtual-projected-net"),
    virtualHistoryCount: document.getElementById("virtual-history-count"),
    virtualHistoryList: document.getElementById("virtual-history-list"),
    virtualLifetimeSessions: document.getElementById("virtual-lifetime-sessions"),
    virtualLifetimeBets: document.getElementById("virtual-lifetime-bets"),
    virtualLifetimeStaked: document.getElementById("virtual-lifetime-staked"),
    virtualLifetimeNetCard: document.getElementById("virtual-lifetime-net-card"),
    virtualLifetimeNet: document.getElementById("virtual-lifetime-net"),
    riskRounds: document.getElementById("risk-rounds"),
    riskNextLabel: document.getElementById("risk-next-label"),
    riskNextStake: document.getElementById("risk-next-stake"),
    riskPriorLoss: document.getElementById("risk-prior-loss"),
    riskTotalRisk: document.getElementById("risk-total-risk"),
    riskGrossPayout: document.getElementById("risk-gross-payout"),
    riskHitCard: document.getElementById("risk-hit-card"),
    riskHitResult: document.getElementById("risk-hit-result"),
    riskMissResult: document.getElementById("risk-miss-result"),
    riskVerdict: document.getElementById("risk-verdict"),
    lastSync: document.getElementById("last-sync"),
    liveRegion: document.getElementById("live-region")
  };

  const store = {
    state: null,
    results: [],
    cycles: [],
    stateLoaded: false,
    stateError: false,
    triples: [],
    triplesLoaded: false,
    triplesError: false,
    triplesHasMore: false,
    triplesVisibleCount: 8,
    lastSyncAt: null,
    refreshing: false,
    refreshQueued: false,
    refreshTimer: null,
    eventSource: null,
    lastRenderedResultKey: null,
    hasCompletedInitialRender: false,
    serverClockMs: null,
    serverClockCapturedAt: null
  };

  function isValidRouletteNumber(value) {
    const number = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
    return Number.isInteger(number) && number >= 0 && number <= 36;
  }

  function asRouletteNumber(value) {
    return isValidRouletteNumber(value) ? Number(value) : null;
  }

  function asNonNegativeInteger(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? Math.trunc(number) : fallback;
  }

  function asOptionalNonNegativeInteger(value) {
    if (value === null || value === undefined || value === "") return null;
    const number = Number(value);
    return Number.isSafeInteger(number) && number >= 0 ? number : null;
  }

  function asOptionalFiniteNumber(value) {
    if (value === null || value === undefined || value === "") return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function rouletteColor(number) {
    if (number === 0) return "green";
    return RED_NUMBERS.has(number) ? "red" : "black";
  }

  function rouletteColorClass(number) {
    return `roulette-${rouletteColor(number)}`;
  }

  function rouletteColorLabel(number) {
    const labels = { green: "зелёное", red: "красное", black: "чёрное" };
    return labels[rouletteColor(number)];
  }

  function pluralForm(value, one, few, many) {
    const absolute = Math.abs(Number(value)) % 100;
    const last = absolute % 10;
    if (absolute > 10 && absolute < 20) return many;
    if (last === 1) return one;
    if (last >= 2 && last <= 4) return few;
    return many;
  }

  function formatPrice(value) {
    if (value === null || value === undefined || value === "") return "—";
    const number = Number(value);
    if (!Number.isFinite(number)) return String(value);
    return new Intl.NumberFormat("ru-RU", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 10,
      useGrouping: false
    }).format(number);
  }

  const riskAmountFormatter = new Intl.NumberFormat("ru-RU", {
    maximumFractionDigits: 0,
    useGrouping: true
  });

  function formatRiskAmount(value) {
    return riskAmountFormatter.format(Math.abs(value));
  }

  function formatSignedRiskAmount(value) {
    if (value > 0) return `+${formatRiskAmount(value)}`;
    if (value < 0) return `−${formatRiskAmount(value)}`;
    return "0";
  }

  function resetRiskOutputs(message) {
    elements.riskNextLabel.textContent = "Следующая ставка";
    elements.riskNextStake.textContent = "—";
    elements.riskPriorLoss.textContent = "—";
    elements.riskTotalRisk.textContent = "—";
    elements.riskGrossPayout.textContent = "—";
    elements.riskHitResult.textContent = "—";
    elements.riskMissResult.textContent = "—";
    elements.riskHitCard.classList.remove("is-positive", "is-loss");
    elements.riskVerdict.className = "risk-verdict is-warning";
    elements.riskVerdict.textContent = message;
  }

  function renderRiskCalculator() {
    const rawValue = elements.riskRounds.value.trim();
    const roundsMissed = rawValue === "" ? Number.NaN : Number(rawValue);
    let risk;

    try {
      risk = calculateBetRisk(roundsMissed);
    } catch {
      elements.riskRounds.setAttribute("aria-invalid", "true");
      resetRiskOutputs(`Введите целое число от 0 до ${riskAmountFormatter.format(BET_RISK_MODEL.maxModeledMisses)}.`);
      return;
    }

    elements.riskRounds.removeAttribute("aria-invalid");
    elements.riskNextLabel.textContent = `Следующий шаг модели · попытка ${riskAmountFormatter.format(risk.nextAttempt)}`;
    elements.riskNextStake.textContent = formatRiskAmount(risk.nextStake);
    elements.riskPriorLoss.textContent = risk.simulatedPriorLoss === 0
      ? "0"
      : `−${formatRiskAmount(risk.simulatedPriorLoss)}`;
    elements.riskTotalRisk.textContent = formatRiskAmount(risk.totalLossIfNextMiss);
    elements.riskGrossPayout.textContent = formatRiskAmount(risk.grossPayoutIfHit);
    elements.riskHitResult.textContent = formatSignedRiskAmount(risk.netIfNextHits);
    elements.riskMissResult.textContent = `−${formatRiskAmount(risk.totalLossIfNextMiss)}`;
    elements.riskHitCard.classList.toggle("is-positive", risk.netIfNextHits > 0);
    elements.riskHitCard.classList.toggle("is-loss", risk.netIfNextHits < 0);

    if (!risk.recoveryPossible) {
      elements.riskVerdict.className = "risk-verdict is-danger";
      elements.riskVerdict.textContent = `Даже совпадение на попытке ${riskAmountFormatter.format(risk.nextAttempt)} уже не покрывает предыдущие потери: итог ${formatSignedRiskAmount(risk.netIfNextHits)}.`;
      return;
    }

    elements.riskVerdict.className = "risk-verdict is-neutral";
    elements.riskVerdict.textContent = risk.capped
      ? `Лимит одной ставки уже достигнут. При каждом следующем промахе общий итог ухудшается ещё на ${formatRiskAmount(BET_RISK_MODEL.maxStake)}.`
      : `Текущий уровень повторяется, пока он покрывает накопленный убыток. Затем модель выбирает минимальную следующую ставку, кратную ${formatRiskAmount(BET_RISK_MODEL.stakeStep)}.`;
  }

  function setTextIfChanged(element, value) {
    const text = String(value);
    if (element.textContent !== text) element.textContent = text;
  }

  function formatVirtualAmount(value) {
    const number = asOptionalFiniteNumber(value);
    return number === null ? "—" : formatRiskAmount(number);
  }

  function formatVirtualOutcome(value) {
    const number = asOptionalFiniteNumber(value);
    if (number === null) return "—";
    if (number > 0) return `Прибыль +${formatRiskAmount(number)}`;
    if (number < 0) return `Убыток −${formatRiskAmount(number)}`;
    return "Итог 0";
  }

  function setVirtualTime(element, value, fallback = "—") {
    const date = parseDate(value);
    if (!date) {
      element.textContent = fallback;
      element.removeAttribute("datetime");
      element.removeAttribute("title");
      return;
    }

    element.dateTime = date.toISOString();
    element.textContent = formatDateTime(date, { alwaysShowDate: true });
    element.title = new Intl.DateTimeFormat("ru-RU", {
      dateStyle: "long",
      timeStyle: "medium"
    }).format(date);
  }

  function renderVirtualBank(testBank, {
    virtualAvailable = false,
    safeSimulation = false,
    topStatus = ""
  } = {}) {
    const resetValues = () => {
      elements.virtualBankInitial.textContent = "—";
      elements.virtualBankCurrent.textContent = "—";
      elements.virtualBankPnl.textContent = "—";
      elements.virtualBankNext.textContent = "—";
      elements.virtualBankNextState.textContent = "Данных нет";
      elements.virtualBankCurrentCard.classList.remove("is-exhausted");
      elements.virtualBankPnlCard.classList.remove("is-positive", "is-loss");
      elements.virtualBankNextCard.classList.remove("is-available", "is-unavailable");
      setVirtualTime(elements.virtualBankStartedAt, null);
      setVirtualTime(elements.virtualBankExhaustedAt, null);
      elements.virtualBankExhaustedWrap.hidden = true;
    };

    const showUnavailable = (state, badge, message, busy = false) => {
      elements.virtualBank.dataset.state = state;
      delete elements.virtualBank.dataset.stale;
      elements.virtualBank.setAttribute("aria-busy", String(busy));
      elements.virtualBankStatus.textContent = badge;
      resetValues();
      setTextIfChanged(elements.virtualBankMessage, message);
    };

    if (!virtualAvailable) {
      if (!store.stateLoaded && !store.stateError) {
        showUnavailable("loading", "Загрузка…", "Получаем состояние виртуального банка.", true);
      } else if (store.stateError) {
        showUnavailable(
          "error",
          "Недоступно",
          "Не удалось получить состояние виртуального банка. Повторим запрос автоматически; реальных действий по-прежнему нет."
        );
      } else {
        showUnavailable("error", "Нет данных", "Сервер не передал состояние виртуального банка.");
      }
      return;
    }

    if (!safeSimulation) {
      showUnavailable(
        "error",
        "Режим не подтверждён",
        "Сервер не подтвердил безопасный режим simulation и запрет исполнения. Значения виртуального банка скрыты."
      );
      return;
    }

    if (!testBank || typeof testBank !== "object") {
      showUnavailable(
        store.stateError ? "stale" : "error",
        store.stateError ? "Не обновлено" : "Нет данных банка",
        store.stateError
          ? "Состояние не обновлено, а последнее полученное состояние виртуального банка отсутствует."
          : "Сервер не передал testBank. Виртуальные суммы не вычисляются в браузере."
      );
      return;
    }

    if (testBank.mode !== "simulation") {
      showUnavailable(
        "error",
        "Режим не подтверждён",
        "Сервер не подтвердил режим simulation для виртуального банка. Значения скрыты для безопасности."
      );
      return;
    }

    const bankStatus = String(testBank.status || "").toLowerCase();
    const topLevelStatus = String(topStatus || "").toLowerCase();
    const exhausted = bankStatus === "exhausted" || topLevelStatus === "bankroll_exhausted";
    const waitingForTarget = topLevelStatus === "waiting";
    const recognizedStatus = bankStatus === "running" || bankStatus === "exhausted";
    const initialBalance = asOptionalFiniteNumber(testBank.initialBalance);
    const currentBalance = asOptionalFiniteNumber(testBank.currentBalance);
    const netResult = asOptionalFiniteNumber(testBank.netResult);
    const nextStakeValue = asOptionalFiniteNumber(testBank.nextStake);
    const nextStake = nextStakeValue !== null && nextStakeValue > 0 ? nextStakeValue : null;
    const shortfallValue = asOptionalFiniteNumber(testBank.shortfall);
    const shortfall = shortfallValue !== null && shortfallValue >= 0 ? shortfallValue : null;
    const canAffordNext = typeof testBank.canAffordNext === "boolean"
      ? testBank.canAffordNext
      : null;
    const dataCompleteKnown = typeof testBank.dataComplete === "boolean";
    const dataComplete = testBank.dataComplete === true;
    const amountsValid = initialBalance !== null
      && initialBalance >= 0
      && currentBalance !== null
      && currentBalance >= 0
      && netResult !== null;

    if (!recognizedStatus || !amountsValid || !dataCompleteKnown) {
      showUnavailable(
        "error",
        "Неполные данные",
        "Сервер передал неполное или некорректное состояние виртуального банка. Значения не показаны, чтобы не создавать ложное впечатление о доступном остатке."
      );
      return;
    }

    const stale = store.stateError;
    let state = exhausted ? "exhausted" : dataComplete ? "running" : "gap";
    if (stale && !exhausted) state = "stale";
    elements.virtualBank.dataset.state = state;
    if (stale) elements.virtualBank.dataset.stale = "true";
    else delete elements.virtualBank.dataset.stale;
    elements.virtualBank.setAttribute("aria-busy", "false");

    let badge = exhausted
      ? "Банк исчерпан"
      : dataComplete
        ? "Банк активен"
        : "Неполные данные";
    if (stale) badge = `Не обновлено · ${badge.toLowerCase()}`;
    elements.virtualBankStatus.textContent = badge;

    elements.virtualBankInitial.textContent = formatVirtualAmount(initialBalance);
    elements.virtualBankCurrent.textContent = formatVirtualAmount(currentBalance);
    elements.virtualBankPnl.textContent = formatVirtualOutcome(netResult);
    elements.virtualBankPnlCard.classList.remove("is-positive", "is-loss");
    if (netResult > 0) elements.virtualBankPnlCard.classList.add("is-positive");
    else if (netResult < 0) elements.virtualBankPnlCard.classList.add("is-loss");
    elements.virtualBankCurrentCard.classList.toggle("is-exhausted", exhausted);

    elements.virtualBankNext.textContent = nextStake === null
      ? "—"
      : formatVirtualAmount(nextStake);
    elements.virtualBankNextCard.classList.remove("is-available", "is-unavailable");
    if (exhausted || canAffordNext === false) {
      elements.virtualBankNextState.textContent = "Недоступен";
      elements.virtualBankNextCard.classList.add("is-unavailable");
    } else if (waitingForTarget && nextStake !== null) {
      elements.virtualBankNextState.textContent = "После выбора цели";
    } else if (nextStake === null) {
      elements.virtualBankNextState.textContent = "Не запланирован";
    } else if (canAffordNext === true) {
      elements.virtualBankNextState.textContent = "Доступен";
      elements.virtualBankNextCard.classList.add("is-available");
    } else {
      elements.virtualBankNextState.textContent = "Доступность неизвестна";
    }

    setVirtualTime(elements.virtualBankStartedAt, testBank.startedAt, "Не указано");
    const exhaustedAt = parseDate(testBank.exhaustedAt);
    elements.virtualBankExhaustedWrap.hidden = !exhaustedAt;
    setVirtualTime(elements.virtualBankExhaustedAt, exhaustedAt);

    let message;
    if (exhausted) {
      const nextText = nextStake === null
        ? "Следующий виртуальный шаг больше недоступен"
        : `Следующий виртуальный шаг ${formatVirtualAmount(nextStake)} недоступен при остатке ${formatVirtualAmount(currentBalance)}`;
      const shortfallText = shortfall && shortfall > 0
        ? `; не хватает ${formatVirtualAmount(shortfall)}`
        : "";
      message = `Виртуальный банк исчерпан. ${nextText}${shortfallText}. Новые виртуальные ставки не рассчитываются.`;
    } else if (waitingForTarget) {
      message = nextStake === null
        ? "Виртуальный банк активен. Цель ещё не выбрана, поэтому виртуальных списаний нет."
        : `Виртуальный банк активен. Цель ещё не выбрана; первый шаг ${formatVirtualAmount(nextStake)} будет рассчитан только после достижения порога.`;
    } else if (nextStake === null) {
      message = "Виртуальный банк активен. Пока цель не выбрана, следующий шаг не запланирован.";
    } else if (canAffordNext === true) {
      message = `Следующий виртуальный шаг ${formatVirtualAmount(nextStake)} доступен при текущем виртуальном остатке ${formatVirtualAmount(currentBalance)}.`;
    } else if (canAffordNext === false) {
      const shortfallText = shortfall && shortfall > 0
        ? ` Не хватает ${formatVirtualAmount(shortfall)}.`
        : "";
      message = `Следующий виртуальный шаг ${formatVirtualAmount(nextStake)} недоступен при текущем виртуальном остатке ${formatVirtualAmount(currentBalance)}.${shortfallText}`;
    } else {
      message = "Сервер не передал доступность следующего виртуального шага.";
    }

    if (!dataComplete) {
      message += " В истории есть разрыв: баланс и P&L учитывают только подтверждённые сохранённые шаги.";
    }
    if (stale) {
      message = `Не удалось обновить состояние; показаны последние полученные значения. ${message}`;
    }
    setTextIfChanged(elements.virtualBankMessage, message);
  }

  function setVirtualNumberBall(element, number, className) {
    element.className = `history-number ${className}`;
    if (number === null) {
      element.textContent = "—";
      return;
    }
    element.classList.add(rouletteColorClass(number));
    element.textContent = String(number);
  }

  function isGapInvalidStatus(value) {
    const status = String(value || "").toLowerCase();
    return status.includes("gap") || status.includes("invalid") || status.includes("integrity");
  }

  function virtualHistoryStatus(value, endReason) {
    const status = String(value || "").toLowerCase();
    const reason = String(endReason || "").toLowerCase();
    if (reason === "integrity_gap" || isGapInvalidStatus(status)) {
      return { state: "invalid", text: "Неполная · разрыв истории" };
    }
    if (reason === "bankroll_exhausted" || status.includes("bankroll_exhausted")) {
      return { state: "stopped", text: "Остановлена · виртуальный банк исчерпан" };
    }
    if (reason === "hit") {
      return { state: "complete", text: "Завершена · цель выпала" };
    }
    if (["won", "hit", "completed", "complete", "success"].some((part) => status.includes(part))) {
      return { state: "complete", text: "Завершена · цель выпала" };
    }
    if (status.includes("cap") || status.includes("limit")) {
      return { state: "stopped", text: "Остановлена · достигнут лимит" };
    }
    if (status.includes("stop") || status.includes("cancel")) {
      return { state: "stopped", text: "Остановлена" };
    }
    return { state: "neutral", text: status ? `Статус: ${status}` : "Завершена" };
  }

  function renderVirtualModel(model) {
    const source = model && typeof model === "object" ? model : {};
    const initialStake = asOptionalFiniteNumber(source.initialStake) ?? BET_RISK_MODEL.initialStake;
    const stakeStep = asOptionalFiniteNumber(source.stakeStep) ?? BET_RISK_MODEL.stakeStep;
    const maxStake = asOptionalFiniteNumber(source.maxStake) ?? BET_RISK_MODEL.maxStake;
    const multiplier = asOptionalFiniteNumber(source.grossPayoutMultiplier) ?? BET_RISK_MODEL.grossPayoutMultiplier;
    elements.virtualModelSummary.textContent = `Ступенчатая модель: старт ${formatVirtualAmount(initialStake)} · шаг +${formatVirtualAmount(stakeStep)} · максимум ${formatVirtualAmount(maxStake)} · валовая выплата ×${formatVirtualAmount(multiplier)}.`;
  }

  function renderVirtualHistory(sessions, emptyMessage = "Завершённых виртуальных сессий пока нет.") {
    const items = Array.isArray(sessions)
      ? sessions.filter((session) => session && typeof session === "object")
      : [];
    elements.virtualHistoryList.setAttribute("aria-busy", "false");
    elements.virtualHistoryCount.textContent = `${items.length} ${pluralForm(items.length, "сессия", "сессии", "сессий")}`;

    if (!items.length) {
      elements.virtualHistoryList.replaceChildren(createElement("li", "empty-state", emptyMessage));
      return;
    }

    const fragment = document.createDocumentFragment();
    items.forEach((session) => {
      const targetNumber = asRouletteNumber(session.targetNumber);
      const status = virtualHistoryStatus(session.status, session.endReason);
      const isInvalid = status.state === "invalid";
      const item = createElement("li", "virtual-history-card");
      item.dataset.state = status.state;
      if (session.id !== null && session.id !== undefined) item.dataset.sessionId = String(session.id);

      const heading = createElement("div", "virtual-history-card__heading");
      const identity = createElement("div", "virtual-history-card__identity");
      const ball = createElement("span", "history-number virtual-history-card__number", targetNumber === null ? "—" : targetNumber);
      if (targetNumber !== null) {
        ball.classList.add(rouletteColorClass(targetNumber));
        ball.setAttribute("aria-label", `Целевое число ${targetNumber}, ${rouletteColorLabel(targetNumber)}`);
      } else {
        ball.setAttribute("aria-label", "Целевое число не указано");
      }
      const copy = createElement("span", "virtual-history-card__copy");
      copy.append(
        createElement("strong", null, targetNumber === null ? "Цель не указана" : `Цель: число ${targetNumber}`),
        createElement("span", null, status.text)
      );
      identity.append(ball, copy);

      const netResult = asOptionalFiniteNumber(session.netResult);
      const result = createElement(
        "span",
        `virtual-history-card__result ${isInvalid ? "is-invalid" : netResult > 0 ? "is-positive" : netResult < 0 ? "is-loss" : ""}`.trim(),
        isInvalid
          ? (netResult === null ? "Итог неизвестен" : `До разрыва: ${formatVirtualOutcome(netResult)}`)
          : formatVirtualOutcome(netResult)
      );
      heading.append(identity, result);

      const metrics = createElement("dl", "virtual-history-card__metrics");
      const facts = [
        ["Серия при выборе", asOptionalNonNegativeInteger(session.triggerRoundsMissed) === null
          ? "—"
          : `${asOptionalNonNegativeInteger(session.triggerRoundsMissed)} раундов`],
        ["Виртуальных ставок", asOptionalNonNegativeInteger(session.attemptCount) ?? "—"],
        ["Всего поставлено", formatVirtualAmount(session.totalStaked)],
        ["Валовая выплата", formatVirtualAmount(session.grossPayout)]
      ];
      facts.forEach(([term, value]) => {
        const fact = createElement("div");
        fact.append(createElement("dt", null, term), createElement("dd", null, value));
        metrics.appendChild(fact);
      });

      const period = createElement("p", "virtual-history-card__period");
      period.append("Выбор: ");
      const selected = createElement("time");
      setVirtualTime(selected, session.selectedAt);
      period.appendChild(selected);
      period.append(" · завершение: ");
      const completed = createElement("time");
      setVirtualTime(completed, session.completedAt);
      period.appendChild(completed);

      item.append(heading, metrics, period);
      fragment.appendChild(item);
    });

    elements.virtualHistoryList.replaceChildren(fragment);
  }

  function renderVirtualLifetime(lifetime) {
    const source = lifetime && typeof lifetime === "object" ? lifetime : null;
    const totalSessions = asOptionalNonNegativeInteger(source?.totalSessions);
    const totalBets = asOptionalNonNegativeInteger(source?.totalBets);
    const totalStaked = asOptionalFiniteNumber(source?.totalStaked);
    const netResult = asOptionalFiniteNumber(source?.netResult);

    elements.virtualLifetimeSessions.textContent = totalSessions === null ? "—" : String(totalSessions);
    elements.virtualLifetimeBets.textContent = totalBets === null ? "—" : String(totalBets);
    elements.virtualLifetimeStaked.textContent = totalStaked === null ? "—" : formatVirtualAmount(totalStaked);
    elements.virtualLifetimeNet.textContent = formatVirtualOutcome(netResult);
    elements.virtualLifetimeNetCard.className = "";
    if (netResult > 0) elements.virtualLifetimeNetCard.classList.add("is-positive");
    else if (netResult < 0) elements.virtualLifetimeNetCard.classList.add("is-loss");
  }

  function renderVirtualBettor(virtualBettor) {
    const available = virtualBettor && typeof virtualBettor === "object";
    const safeSimulation = available
      && virtualBettor.mode === "simulation"
      && virtualBettor.executionEnabled === false;
    renderVirtualBank(available ? virtualBettor.testBank : null, {
      virtualAvailable: available,
      safeSimulation,
      topStatus: virtualBettor?.status
    });

    if (!available) {
      const missingFromState = store.stateLoaded && !store.stateError;
      elements.virtualPanel.dataset.state = store.stateError || missingFromState ? "error" : "loading";
      elements.virtualStatusBadge.textContent = store.stateError
        ? "Недоступно"
        : missingFromState
          ? "Нет данных"
          : "Загрузка…";
      elements.virtualStatusTitle.textContent = store.stateError
        ? "Не удалось получить состояние симуляции"
        : missingFromState
          ? "Сервер не передал состояние автотеста"
          : "Получаем состояние…";
      setTextIfChanged(
        elements.virtualStatusCopy,
        store.stateError
          ? "Расчёты не обновлены. Панель повторит запрос автоматически; реальных действий по-прежнему нет."
          : missingFromState
            ? "В ответе /api/state пока нет virtualBettor. Панель остаётся только информационной и повторит запрос автоматически."
            : "Ожидаем данные безопасного режима симуляции."
      );
      elements.virtualProgressLabel.textContent = "Прогресс до условия запуска";
      elements.virtualProgress.max = 200;
      elements.virtualProgress.value = 0;
      elements.virtualProgress.setAttribute("aria-valuetext", "Данных пока нет");
      elements.virtualProgressValue.textContent = "— из 200";
      elements.virtualCandidate.hidden = true;
      elements.virtualSession.hidden = true;
      renderVirtualModel(null);
      renderVirtualHistory([], store.stateError
        ? "История симуляции сейчас недоступна."
        : missingFromState
          ? "История симуляции ещё не передана сервером."
          : "Загрузка истории виртуального эксперимента…");
      renderVirtualLifetime(null);
      return;
    }

    if (!safeSimulation) {
      elements.virtualPanel.dataset.state = "error";
      elements.virtualStatusBadge.textContent = "Режим не подтверждён";
      elements.virtualStatusTitle.textContent = "Расчёты скрыты для безопасности";
      setTextIfChanged(
        elements.virtualStatusCopy,
        "Сервер не подтвердил одновременно режим simulation и запрет исполнения. Эта панель не показывает и не предоставляет действий со ставками."
      );
      elements.virtualProgressLabel.textContent = "Прогресс недоступен";
      elements.virtualProgress.max = 200;
      elements.virtualProgress.value = 0;
      elements.virtualProgress.setAttribute("aria-valuetext", "Безопасный режим не подтверждён");
      elements.virtualProgressValue.textContent = "—";
      elements.virtualCandidate.hidden = true;
      elements.virtualSession.hidden = true;
      renderVirtualModel(virtualBettor.model);
      renderVirtualHistory([], "История скрыта: безопасный режим симуляции не подтверждён.");
      renderVirtualLifetime(null);
      return;
    }

    const triggerThresholdValue = asOptionalNonNegativeInteger(virtualBettor.triggerThreshold);
    const triggerThreshold = triggerThresholdValue && triggerThresholdValue > 0
      ? triggerThresholdValue
      : 200;
    const candidate = virtualBettor.longestCandidate && typeof virtualBettor.longestCandidate === "object"
      ? virtualBettor.longestCandidate
      : null;
    const candidateNumber = asRouletteNumber(candidate?.number);
    const candidateRounds = asOptionalNonNegativeInteger(candidate?.roundsSinceLast);
    const activeSession = virtualBettor.activeSession && typeof virtualBettor.activeSession === "object"
      ? virtualBettor.activeSession
      : null;
    const targetNumber = asRouletteNumber(activeSession?.targetNumber);
    const triggerRounds = asOptionalNonNegativeInteger(activeSession?.triggerRoundsMissed);
    const rawStatus = String(virtualBettor.status || "").toLowerCase();
    const bankStatus = String(virtualBettor.testBank?.status || "").toLowerCase();
    const bankExhausted = rawStatus === "bankroll_exhausted" || bankStatus === "exhausted";
    const sessionHasGap = isGapInvalidStatus(activeSession?.status);
    const hasSession = activeSession !== null && targetNumber !== null;
    const progressRounds = hasSession ? triggerRounds : candidateRounds;
    const stalePrefix = store.stateError
      ? "Не удалось обновить состояние; показаны последние полученные данные. "
      : "";

    let panelState = rawStatus;
    let badge = "Состояние неизвестно";
    let title = "Состояние автотеста не распознано";
    let copy = "Ожидаем корректное состояние от сервера.";

    if (bankExhausted) {
      panelState = "exhausted";
      badge = "Банк исчерпан";
      title = "Виртуальный банк исчерпан";
      copy = "Тестовая симуляция остановлена: доступного виртуального остатка недостаточно для следующего шага. Реальных действий и списаний не было.";
    } else if (sessionHasGap || isGapInvalidStatus(rawStatus)) {
      panelState = "invalid";
      badge = "Разрыв истории";
      title = "Сессия не засчитана";
      copy = "В подтверждённой последовательности найден разрыв. Сессия остановлена: известные шаги до разрыва сохранены, а неизвестные раунды не моделируются.";
    } else if (rawStatus === "waiting") {
      panelState = "waiting";
      badge = "Ожидание";
      title = `Ждём ${triggerThreshold} сохранённых раундов`;
      copy = candidateNumber === null || candidateRounds === null
        ? "Подтверждённой истории пока недостаточно для выбора виртуальной цели."
        : `Самая длинная текущая серия у числа ${candidateNumber}: ${candidateRounds} ${pluralForm(candidateRounds, "сохранённый раунд", "сохранённых раунда", "сохранённых раундов")} без выпадения.`;
    } else if (rawStatus === "armed") {
      panelState = "armed";
      badge = "Цель выбрана";
      title = "Триггер достигнут, ставка ещё не считалась";
      copy = "Цель уже зафиксирована. Триггерный раунд служит только для выбора; первый виртуальный шаг начнётся со следующего сохранённого результата.";
    } else if (rawStatus === "active") {
      panelState = "active";
      badge = "Симуляция идёт";
      title = "Активна виртуальная сессия";
      copy = targetNumber === null
        ? "Сессия активна, но данные целевого числа пока недоступны."
        : `Цель — число ${targetNumber}. Она заморожена и не меняется до завершения этой виртуальной сессии.`;
    }

    if (store.stateError && panelState !== "invalid") {
      if (panelState !== "exhausted") panelState = "stale";
      badge = `Не обновлено · ${badge.toLowerCase()}`;
    }

    elements.virtualPanel.dataset.state = panelState;
    elements.virtualStatusBadge.textContent = badge;
    elements.virtualStatusTitle.textContent = title;
    setTextIfChanged(elements.virtualStatusCopy, `${stalePrefix}${copy}`);
    renderVirtualModel(hasSession ? (activeSession.model ?? virtualBettor.model) : virtualBettor.model);

    elements.virtualProgressLabel.textContent = hasSession
      ? "Порог, при котором выбрана цель"
      : "Прогресс самой длинной серии";
    elements.virtualProgress.max = triggerThreshold;
    elements.virtualProgress.value = progressRounds === null
      ? 0
      : Math.min(progressRounds, triggerThreshold);
    elements.virtualProgressValue.textContent = progressRounds === null
      ? `— из ${triggerThreshold}`
      : `${progressRounds} из ${triggerThreshold}`;
    elements.virtualProgress.setAttribute(
      "aria-valuetext",
      progressRounds === null
        ? `Нет данных из требуемых ${triggerThreshold} раундов`
        : `${progressRounds} из требуемых ${triggerThreshold} сохранённых раундов`
    );

    const showCandidate = !hasSession && candidateNumber !== null && candidateRounds !== null;
    elements.virtualCandidate.hidden = !showCandidate;
    if (showCandidate) {
      setVirtualNumberBall(elements.virtualCandidateNumber, candidateNumber, "virtual-candidate__number");
      elements.virtualCandidateTitle.textContent = `Число ${candidateNumber} · самая длинная серия`;
      const candidateLastSeen = parseDate(candidate.lastSeenAt);
      const candidateHistory = candidateLastSeen
        ? `последнее: ${formatDateTime(candidateLastSeen, { alwaysShowDate: true })}`
        : "ещё не встречалось в текущем непрерывном участке";
      elements.virtualCandidateMeta.textContent = `${candidateRounds} ${pluralForm(candidateRounds, "сохранённый раунд", "сохранённых раунда", "сохранённых раундов")} без выпадения · ${candidateHistory}`;
      elements.virtualCandidate.setAttribute(
        "aria-label",
        candidateLastSeen
          ? `Самая длинная серия: число ${candidateNumber}, ${rouletteColorLabel(candidateNumber)}, ${candidateRounds} ${pluralForm(candidateRounds, "сохранённый раунд", "сохранённых раунда", "сохранённых раундов")} без выпадения; последнее выпадение ${formatDateTime(candidateLastSeen, { alwaysShowDate: true })}`
          : `Самая длинная серия: число ${candidateNumber}, ${rouletteColorLabel(candidateNumber)}, ещё не встречалось в текущем непрерывном участке из ${candidateRounds} ${pluralForm(candidateRounds, "сохранённого раунда", "сохранённых раундов", "сохранённых раундов")}`
      );
    } else {
      elements.virtualCandidate.removeAttribute("aria-label");
    }

    elements.virtualSession.hidden = !hasSession;
    if (hasSession) {
      if (activeSession.id !== null && activeSession.id !== undefined) {
        elements.virtualSession.dataset.sessionId = String(activeSession.id);
      } else {
        delete elements.virtualSession.dataset.sessionId;
      }
      setVirtualNumberBall(elements.virtualTargetNumber, targetNumber, "virtual-session__target");
      elements.virtualSessionTitle.textContent = `Число ${targetNumber}`;
      elements.virtualTargetSummary.textContent = sessionHasGap
        ? "Сессия помечена недействительной из-за разрыва истории."
        : rawStatus === "armed"
          ? "Цель зафиксирована; ждём следующий сохранённый раунд."
          : "Цель не меняется до завершения виртуальной сессии.";
      elements.virtualTriggerRounds.textContent = triggerRounds === null
        ? "—"
        : `${triggerRounds} ${pluralForm(triggerRounds, "сохранённый раунд", "сохранённых раунда", "сохранённых раундов")}`;
      setVirtualTime(elements.virtualSelectedAt, activeSession.selectedAt);
      setVirtualTime(elements.virtualStartedAt, activeSession.startedAt, "Ещё не началась");
      elements.virtualAttemptCount.textContent = String(asOptionalNonNegativeInteger(activeSession.attemptCount) ?? 0);
      elements.virtualMissCount.textContent = String(asOptionalNonNegativeInteger(activeSession.missCount) ?? 0);
      elements.virtualTotalStaked.textContent = formatVirtualAmount(activeSession.totalStaked);
      elements.virtualNextStake.textContent = formatVirtualAmount(activeSession.nextStake);
      elements.virtualProjectedGross.textContent = formatVirtualAmount(activeSession.projectedGrossPayout);

      const projectedNet = asOptionalFiniteNumber(activeSession.projectedNetIfHit);
      elements.virtualProjectedNet.textContent = formatVirtualOutcome(projectedNet);
      elements.virtualProjectedNetCard.className = "virtual-session__outcome";
      if (sessionHasGap) elements.virtualProjectedNetCard.classList.add("is-invalid");
      else if (projectedNet > 0) elements.virtualProjectedNetCard.classList.add("is-positive");
      else if (projectedNet < 0) elements.virtualProjectedNetCard.classList.add("is-loss");
    } else {
      delete elements.virtualSession.dataset.sessionId;
    }

    renderVirtualHistory(virtualBettor.recentSessions);
    renderVirtualLifetime(virtualBettor.lifetime);
  }

  function parseDate(value) {
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function formatDateTime(value, options = {}) {
    if (!value) return "—";
    const date = parseDate(value);
    if (!date) return String(value);

    const now = new Date();
    const sameDay = date.getFullYear() === now.getFullYear()
      && date.getMonth() === now.getMonth()
      && date.getDate() === now.getDate();

    const formatOptions = {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    };

    if (!sameDay || options.alwaysShowDate) {
      formatOptions.day = "2-digit";
      formatOptions.month = "2-digit";
      if (date.getFullYear() !== now.getFullYear()) formatOptions.year = "numeric";
    }

    return new Intl.DateTimeFormat("ru-RU", formatOptions).format(date);
  }

  function formatCyclePeriod(startedAt, completedAt) {
    if (!startedAt && !completedAt) return "Время не указано";
    if (!completedAt) return `с ${formatDateTime(startedAt)}`;
    if (!startedAt) return `до ${formatDateTime(completedAt)}`;
    return `${formatDateTime(startedAt)} — ${formatDateTime(completedAt)}`;
  }

  function formatRelative(value) {
    const date = value instanceof Date ? value : parseDate(value);
    if (!date) return "";
    const seconds = Math.max(0, Math.round((Date.now() - date.getTime()) / 1000));
    if (seconds < 8) return "только что";
    if (seconds < 60) return `${seconds} сек. назад`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes} мин. назад`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} ч. назад`;
    return formatDateTime(date, { alwaysShowDate: true });
  }

  function captureServerClock(value) {
    const date = parseDate(value);
    if (!date) return;
    store.serverClockMs = date.getTime();
    store.serverClockCapturedAt = window.performance.now();
  }

  function currentTimeMs() {
    if (Number.isFinite(store.serverClockMs) && Number.isFinite(store.serverClockCapturedAt)) {
      return store.serverClockMs + (window.performance.now() - store.serverClockCapturedAt);
    }
    return Date.now();
  }

  function elapsedDuration(value) {
    const date = parseDate(value);
    if (!date) return null;
    return Math.max(0, currentTimeMs() - date.getTime());
  }

  function formatElapsedCompact(milliseconds) {
    const totalMinutes = Math.floor(milliseconds / 60_000);
    if (totalMinutes < 1) return "<1м";
    if (totalMinutes < 60) return `${totalMinutes}м`;

    const totalHours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    if (totalHours < 24) return minutes ? `${totalHours}ч ${minutes}м` : `${totalHours}ч`;

    const days = Math.floor(totalHours / 24);
    const hours = totalHours % 24;
    if (days < 30 && hours) return `${days}д ${hours}ч`;
    return `${days}д`;
  }

  function formatElapsedLong(milliseconds) {
    const totalMinutes = Math.floor(milliseconds / 60_000);
    if (totalMinutes < 1) return "меньше минуты назад";
    if (totalMinutes < 60) {
      return `${totalMinutes} ${pluralForm(totalMinutes, "минуту", "минуты", "минут")} назад`;
    }

    const totalHours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    if (totalHours < 24) {
      const parts = [`${totalHours} ${pluralForm(totalHours, "час", "часа", "часов")}`];
      if (minutes) parts.push(`${minutes} ${pluralForm(minutes, "минуту", "минуты", "минут")}`);
      return `${parts.join(" ")} назад`;
    }

    const days = Math.floor(totalHours / 24);
    const hours = totalHours % 24;
    const parts = [`${days} ${pluralForm(days, "день", "дня", "дней")}`];
    if (days < 30 && hours) parts.push(`${hours} ${pluralForm(hours, "час", "часа", "часов")}`);
    return `${parts.join(" ")} назад`;
  }

  function numberAgeInfo(lastSeenAt) {
    const elapsed = elapsedDuration(lastSeenAt);
    if (elapsed === null) {
      return {
        compact: "—",
        aria: "в накопленной истории ещё нет сохранённого выпадения",
        title: "В накопленной истории ещё нет сохранённого выпадения"
      };
    }

    const long = formatElapsedLong(elapsed);
    return {
      compact: formatElapsedCompact(elapsed),
      aria: `последнее сохранённое выпадение ${long}`,
      title: `Последнее сохранённое выпадение: ${formatDateTime(lastSeenAt, { alwaysShowDate: true })} · ${long}`
    };
  }

  function compactId(value) {
    if (value === null || value === undefined || value === "") return "—";
    const string = String(value);
    return string.length > 18 ? `${string.slice(0, 8)}…${string.slice(-5)}` : string;
  }

  function createElement(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined && text !== null) element.textContent = String(text);
    return element;
  }

  function setConnection(state, label) {
    elements.connection.dataset.state = state;
    elements.connectionLabel.textContent = label;
  }

  function announce(message) {
    elements.liveRegion.textContent = "";
    window.setTimeout(() => {
      elements.liveRegion.textContent = message;
    }, 30);
  }

  async function fetchJson(url) {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 12_000);
    try {
      const response = await fetch(url, {
        headers: { Accept: "application/json" },
        cache: "no-store",
        signal: controller.signal
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } finally {
      window.clearTimeout(timeout);
    }
  }

  function extractItems(payload) {
    if (Array.isArray(payload)) return payload;
    return Array.isArray(payload?.items) ? payload.items : [];
  }

  async function refreshAll({ notify = false } = {}) {
    if (store.refreshing) {
      store.refreshQueued = true;
      return;
    }

    store.refreshing = true;
    elements.refreshButton.classList.add("is-loading");
    elements.refreshButton.disabled = true;
    elements.main.setAttribute("aria-busy", "true");

    const requests = await Promise.allSettled([
      fetchJson("/api/state"),
      fetchJson("/api/results?limit=80"),
      fetchJson("/api/cycles?limit=10"),
      fetchJson("/api/sequences?limit=50")
    ]);

    let successfulRequests = 0;

    if (requests[0].status === "fulfilled") {
      store.state = requests[0].value;
      store.stateLoaded = true;
      store.stateError = false;
      captureServerClock(store.state?.serverTime);
      successfulRequests += 1;
    } else {
      store.stateError = true;
    }
    if (requests[1].status === "fulfilled") {
      store.results = extractItems(requests[1].value);
      successfulRequests += 1;
    }
    if (requests[2].status === "fulfilled") {
      store.cycles = extractItems(requests[2].value);
      successfulRequests += 1;
    }
    if (requests[3].status === "fulfilled") {
      store.triples = extractItems(requests[3].value);
      store.triplesHasMore = requests[3].value?.hasMore === true;
      store.triplesLoaded = true;
      store.triplesError = false;
      successfulRequests += 1;
    } else {
      store.triplesError = true;
    }

    if (successfulRequests > 0) {
      store.lastSyncAt = new Date();
      renderAll();
      if (notify) announce(successfulRequests === requests.length ? "Данные обновлены" : "Данные обновлены частично");
      if (!store.eventSource || store.eventSource.readyState !== EventSource.OPEN) {
        setConnection(successfulRequests === requests.length ? "connecting" : "error", successfulRequests === requests.length ? "API доступен" : "Данные получены частично");
      }
    } else {
      renderFetchFailure();
      setConnection("error", "API недоступен");
      if (notify) announce("Не удалось обновить данные");
    }

    store.refreshing = false;
    elements.refreshButton.classList.remove("is-loading");
    elements.refreshButton.disabled = false;
    elements.main.removeAttribute("aria-busy");

    if (store.refreshQueued) {
      store.refreshQueued = false;
      refreshAll();
    }
  }

  function renderFetchFailure() {
    if (!store.hasCompletedInitialRender) {
      elements.resultsBody.replaceChildren(emptyTableRow("Не удалось загрузить результаты. Повторим попытку автоматически."));
      elements.cyclesList.replaceChildren(createElement("li", "empty-state", "Не удалось загрузить архив циклов."));
      elements.triplesList.replaceChildren(createElement("li", "empty-state", "Не удалось загрузить тройки. Повторим автоматически."));
      elements.triplesList.setAttribute("aria-busy", "false");
      elements.triplesCount.textContent = "— · ошибка";
      elements.triplesCount.title = "Не удалось загрузить повторяющиеся тройки";
      elements.triplesToggle.hidden = true;
      elements.overdueList.replaceChildren(createElement("li", "empty-state", "Не удалось рассчитать давность выпадений."));
      elements.overdueList.setAttribute("aria-busy", "false");
      elements.collectorCard.dataset.state = "error";
      elements.collectorStatus.textContent = "Нет связи с сервером";
      elements.boardNote.textContent = "Не удалось получить состояние активного цикла.";
    }
    renderVirtualBettor(store.state?.virtualBettor || null);
  }

  function renderAll() {
    renderCollector(store.state?.collector);
    renderGapWarning(store.state);
    renderLatestResult(store.state?.latestResult || store.results[0] || null);
    renderOverdueNumbers();
    renderActiveCycle(store.state?.activeCycle || null);
    renderTriples();
    renderResults(store.results, store.state?.stats);
    renderCycles(store.cycles, store.state?.stats);
    renderVirtualBettor(store.state?.virtualBettor || null);
    updateLastSync();
    store.hasCompletedInitialRender = true;
  }

  function renderCollector(collector) {
    if (!collector) {
      elements.collectorCard.dataset.state = "unknown";
      elements.collectorStatus.textContent = "Состояние неизвестно";
      elements.collectorCard.removeAttribute("title");
      return;
    }

    const status = String(collector.status || "unknown").toLowerCase();
    const connected = collector.connected === true;
    let state = connected ? "online" : "offline";
    let label = connected ? "Работает" : "Нет связи с источником";

    if (["starting", "connecting"].includes(status)) {
      state = "unknown";
      label = "Запускается";
    } else if (["reconnecting", "retrying"].includes(status)) {
      state = "unknown";
      label = "Переподключение";
    } else if (["error", "failed"].includes(status)) {
      state = "error";
      label = "Ошибка коллектора";
    } else if (["stopped", "idle", "disabled"].includes(status)) {
      state = "offline";
      label = "Остановлен";
    } else if (["running", "online", "connected"].includes(status) && connected) {
      state = "online";
      label = "Работает";
    }

    elements.collectorCard.dataset.state = state;
    elements.collectorStatus.textContent = label;

    const details = [];
    if (collector.lastMessageAt) details.push(`Последнее сообщение: ${formatDateTime(collector.lastMessageAt)}`);
    if (collector.retryCount) details.push(`Попыток переподключения: ${collector.retryCount}`);
    if (collector.error) details.push(`Ошибка: ${collector.error}`);
    if (details.length) elements.collectorCard.title = details.join("\n");
    else elements.collectorCard.removeAttribute("title");
  }

  function renderGapWarning(state) {
    const warnings = Array.isArray(state?.warnings) ? state.warnings : [];
    const integrity = String(state?.activeCycle?.integrityStatus || "").toLowerCase();
    const integrityHasGap = integrity && !["ok", "complete", "valid", "verified"].includes(integrity);
    const hasFreshActiveCycle = String(state?.activeCycle?.status || "").toLowerCase() === "active"
      && !integrityHasGap;
    const gapWarning = hasFreshActiveCycle ? null : warnings.find((warning) => {
      const type = String(warning?.type || "").toLowerCase();
      return type.includes("gap") || type.includes("missing") || type.includes("integrity");
    });
    const hasGap = Boolean(gapWarning || integrityHasGap);

    elements.gapAlert.hidden = !hasGap;
    if (hasGap) {
      elements.gapMessage.textContent = gapWarning?.message
        || "Часть раундов могла быть пропущена. Итог текущего цикла не считается подтверждённым.";
    }
  }

  function renderLatestResult(result) {
    elements.lastNumber.className = "result-ball";

    const number = asRouletteNumber(result?.number);
    if (number === null) {
      elements.lastNumber.classList.add("result-ball--empty");
      elements.lastNumber.textContent = "—";
      elements.lastNumber.setAttribute("aria-label", "Результат пока не получен");
      elements.lastTime.textContent = "—";
      elements.lastPrice.textContent = "—";
      elements.lastRound.textContent = "—";
      return;
    }

    elements.lastNumber.classList.add(rouletteColorClass(number));
    elements.lastNumber.textContent = String(number);
    elements.lastNumber.setAttribute("aria-label", `Последнее выпадение: ${number}, ${rouletteColorLabel(number)}`);
    elements.lastTime.textContent = formatDateTime(result.settledAt || result.observedAt);
    elements.lastTime.title = result.settledAt ? String(result.settledAt) : "";
    elements.lastPrice.textContent = formatPrice(result.price);
    const roundId = result.roundId ?? result.externalRoundId ?? null;
    elements.lastRound.textContent = compactId(roundId);
    elements.lastRound.title = roundId === null ? "" : String(roundId);

    const resultKey = `${result.id ?? ""}|${number}|${result.settledAt ?? result.observedAt ?? ""}`;
    if (store.hasCompletedInitialRender && store.lastRenderedResultKey && store.lastRenderedResultKey !== resultKey) {
      announce(`Новое выпадение: ${number}, ${rouletteColorLabel(number)}`);
    }
    store.lastRenderedResultKey = resultKey;
  }

  function normalizedCycleNumbers(cycle) {
    const records = new Map();
    if (Array.isArray(cycle?.numbers)) {
      cycle.numbers.forEach((record) => {
        const number = asRouletteNumber(record?.number);
        if (number !== null) records.set(number, record);
      });
    }

    const completedSurvivor = cycleIsComplete(cycle)
      ? asRouletteNumber(cycle?.survivorNumber)
      : null;
    const suppliedRemaining = Array.isArray(cycle?.remainingNumbers)
      ? new Set(cycle.remainingNumbers.map(asRouletteNumber).filter((number) => number !== null))
      : completedSurvivor !== null
        ? new Set([completedSurvivor])
        : null;

    const remaining = suppliedRemaining || new Set(
      ALL_NUMBERS.filter((number) => !records.get(number)?.eliminated)
    );

    return { records, remaining };
  }

  function normalizedNumberStats() {
    const stats = new Map();
    const items = Array.isArray(store.state?.numberStats) ? store.state.numberStats : [];
    items.forEach((item) => {
      const number = asRouletteNumber(item?.number);
      if (number === null) return;
      stats.set(number, {
        occurrenceCount: asNonNegativeInteger(item?.occurrenceCount, 0),
        lastSeenAt: item?.lastSeenAt || null,
        roundsSinceLast:
          item?.roundsSinceLast === null || item?.roundsSinceLast === undefined
            ? null
            : asNonNegativeInteger(item.roundsSinceLast, 0)
      });
    });
    return stats;
  }

  function renderOverdueNumbers() {
    const hasStats = Array.isArray(store.state?.numberStats);
    const stats = normalizedNumberStats();
    elements.overdueList.setAttribute("aria-busy", "false");

    if (!hasStats) {
      elements.overdueList.replaceChildren(createElement("li", "empty-state", "Статистика давности пока недоступна."));
      return;
    }

    const items = ALL_NUMBERS
      .map((number) => ({
        number,
        occurrenceCount: stats.get(number)?.occurrenceCount ?? 0,
        lastSeenAt: stats.get(number)?.lastSeenAt ?? null,
        lastSeenDate: parseDate(stats.get(number)?.lastSeenAt),
        roundsSinceLast: stats.get(number)?.roundsSinceLast ?? null
      }))
      .filter((item) => item.lastSeenDate !== null && Number.isInteger(item.roundsSinceLast))
      .sort((left, right) =>
        right.roundsSinceLast - left.roundsSinceLast ||
        left.lastSeenDate.getTime() - right.lastSeenDate.getTime() ||
        left.number - right.number
      )
      .slice(0, 3);

    if (!items.length) {
      elements.overdueList.replaceChildren(createElement("li", "empty-state", "Недостаточно накопленной истории для расчёта."));
      return;
    }

    const fragment = document.createDocumentFragment();
    items.forEach((item, index) => {
      const card = createElement("li", "overdue-card");
      const rank = createElement("span", "overdue-card__rank", `#${index + 1}`);
      rank.setAttribute("aria-hidden", "true");
      const ball = createElement("span", `history-number overdue-card__number ${rouletteColorClass(item.number)}`, item.number);
      ball.setAttribute("aria-hidden", "true");
      const copy = createElement("span", "overdue-card__copy");
      const age = createElement("strong", "overdue-card__age");
      const rounds = createElement(
        "span",
        "overdue-card__rounds",
        `${item.roundsSinceLast} ${pluralForm(item.roundsSinceLast, "сохранённый раунд", "сохранённых раунда", "сохранённых раундов")} без выпадения`
      );
      const last = createElement("time", "overdue-card__last", `Последнее: ${formatDateTime(item.lastSeenAt)}`);
      last.dateTime = item.lastSeenAt;
      last.setAttribute("aria-hidden", "true");
      age.dataset.lastSeenAt = item.lastSeenAt;
      card.dataset.rank = String(index + 1);
      card.dataset.number = String(item.number);
      card.dataset.occurrenceCount = String(item.occurrenceCount);
      card.dataset.roundsSinceLast = String(item.roundsSinceLast);
      copy.append(age, rounds, last);
      card.append(rank, ball, copy);
      fragment.appendChild(card);
    });

    elements.overdueList.replaceChildren(fragment);
    updateOverdueAges();
  }

  function updateOverdueAges() {
    elements.overdueList.querySelectorAll(".overdue-card__age").forEach((age) => {
      const card = age.closest(".overdue-card");
      if (!card) return;
      const lastSeenAt = age.dataset.lastSeenAt || null;
      const elapsed = elapsedDuration(lastSeenAt);
      const number = asRouletteNumber(card.dataset.number);
      const rank = asNonNegativeInteger(card.dataset.rank, 0);
      const occurrenceCount = asNonNegativeInteger(card.dataset.occurrenceCount, 0);
      const roundsSinceLast = asNonNegativeInteger(card.dataset.roundsSinceLast, 0);
      const roundsText = `${roundsSinceLast} ${pluralForm(roundsSinceLast, "сохранённый раунд", "сохранённых раунда", "сохранённых раундов")} без выпадения`;

      const rounds = card.querySelector(".overdue-card__rounds");
      if (rounds) rounds.textContent = roundsText;

      age.textContent = elapsed === null ? "—" : formatElapsedCompact(elapsed);
      card.setAttribute(
        "aria-label",
        `${rank} место, число ${number}, ${rouletteColorLabel(number)}; ${roundsText}; последнее сохранённое выпадение ${elapsed === null ? "неизвестно когда" : formatElapsedLong(elapsed)}${lastSeenAt ? `, ${formatDateTime(lastSeenAt, { alwaysShowDate: true })}` : ""}`
      );
      card.title = `Всего в базе: ${occurrenceCount} ${pluralForm(occurrenceCount, "выпадение", "выпадения", "выпадений")}`;
    });
  }

  function renderActiveCycle(cycle) {
    if (!cycle) {
      elements.cycleId.textContent = "Цикл —";
      setProgressValues(0, 37, 0, 0, null);
      renderNumberGrid(null);
      return;
    }

    const { records, remaining } = normalizedCycleNumbers(cycle);
    const uniqueCount = Math.min(36, asNonNegativeInteger(cycle.uniqueCount, 37 - remaining.size));
    const remainingCount = Math.min(37, asNonNegativeInteger(cycle.remainingCount, remaining.size));
    const totalDraws = asNonNegativeInteger(cycle.totalDraws, uniqueCount);
    const repeatCount = Math.max(0, totalDraws - uniqueCount);

    elements.cycleId.textContent = cycle.id === null || cycle.id === undefined ? "Текущий цикл" : `Цикл ${compactId(cycle.id)}`;
    elements.cycleId.title = cycle.id === null || cycle.id === undefined ? "" : String(cycle.id);
    setProgressValues(uniqueCount, remainingCount, totalDraws, repeatCount, cycle.startedAt);
    renderNumberGrid(cycle, records, remaining);
  }

  function setProgressValues(uniqueCount, remainingCount, totalDraws, repeatCount, startedAt) {
    const progressPercent = Math.max(0, Math.min(100, (uniqueCount / 36) * 100));
    elements.progressRing.style.setProperty("--progress", progressPercent.toFixed(2));
    elements.progressValue.textContent = String(uniqueCount);
    elements.cycleProgress.value = uniqueCount;
    elements.cycleProgress.textContent = `${uniqueCount} из 36`;
    elements.cycleProgress.setAttribute("aria-label", `Исключено ${uniqueCount} из 36 необходимых чисел`);
    elements.remainingCount.textContent = String(remainingCount);
    elements.remainingLabel.textContent = `${pluralForm(remainingCount, "число", "числа", "чисел")} осталось`;
    elements.drawCount.textContent = String(totalDraws);
    elements.repeatCount.textContent = String(repeatCount);
    elements.cycleStart.textContent = formatDateTime(startedAt);
    elements.cycleStart.title = startedAt ? String(startedAt) : "";
  }

  function renderNumberGrid(cycle, providedRecords, providedRemaining) {
    const records = providedRecords || new Map();
    const remaining = providedRemaining || new Set(ALL_NUMBERS);
    const numberStats = normalizedNumberStats();
    const fragment = document.createDocumentFragment();
    const survivor = cycle && remaining.size === 1 ? Array.from(remaining)[0] : null;

    ALL_NUMBERS.forEach((number) => {
      const record = records.get(number);
      const history = numberStats.get(number) || { occurrenceCount: 0, lastSeenAt: null };
      const isRemaining = remaining.has(number);
      const occurrenceCount = asNonNegativeInteger(record?.occurrenceCount, record?.eliminated ? 1 : 0);
      const cell = createElement("li", `number-cell ${rouletteColorClass(number)}`);
      const value = createElement("span", "number-cell__value", number);
      const age = createElement("time", "number-cell__age");
      cell.classList.add(isRemaining ? "is-remaining" : "is-eliminated");
      if (number === survivor) cell.classList.add("is-survivor");

      let stateLabel = isRemaining ? "осталось в цикле" : "исключено";
      if (!isRemaining && occurrenceCount > 0) {
        stateLabel += `, выпадало ${occurrenceCount} ${pluralForm(occurrenceCount, "раз", "раза", "раз")}`;
      }
      cell.dataset.baseAria = `Число ${number}, ${rouletteColorLabel(number)}, ${stateLabel}`;
      cell.dataset.baseTitle = record?.firstSeenAt
        ? `Первое выпадение в текущем цикле: ${formatDateTime(record.firstSeenAt)}`
        : "";
      age.dataset.lastSeenAt = history.lastSeenAt || "";
      age.dataset.occurrenceCount = String(history.occurrenceCount);
      if (history.lastSeenAt) age.dateTime = history.lastSeenAt;
      cell.append(value, age);
      fragment.appendChild(cell);
    });

    elements.numberGrid.replaceChildren(fragment);

    let note;
    if (!cycle) {
      note = "Активный цикл появится после первого сохранённого результата.";
    } else if (survivor !== null && cycleIsComplete(cycle)) {
      note = `Цикл завершён. Осталось число ${survivor}; новый цикл начнётся со следующего результата.`;
    } else if (survivor !== null) {
      note = `Осталось одно число — ${survivor}. Ожидаем завершение цикла.`;
    } else {
      const count = remaining.size;
      note = `В текущем цикле ещё не выпадало ${count} ${pluralForm(count, "число", "числа", "чисел")}.`;
    }
    elements.boardNote.textContent = `${note} Время под числом — с последнего сохранённого выпадения.`;
    updateNumberAges();
  }

  function updateNumberAges() {
    elements.numberGrid.querySelectorAll(".number-cell__age").forEach((age) => {
      const cell = age.closest(".number-cell");
      if (!cell) return;
      const lastSeenAt = age.dataset.lastSeenAt || null;
      const occurrenceCount = asNonNegativeInteger(age.dataset.occurrenceCount, 0);
      const info = numberAgeInfo(lastSeenAt);
      const totalLabel = occurrenceCount > 0
        ? `всего в базе ${occurrenceCount} ${pluralForm(occurrenceCount, "выпадение", "выпадения", "выпадений")}`
        : "в базе пока нет выпадений";

      age.textContent = info.compact;
      cell.setAttribute("aria-label", `${cell.dataset.baseAria}; ${info.aria}; ${totalLabel}`);
      cell.title = [cell.dataset.baseTitle, info.title, `За всю накопленную историю: ${occurrenceCount}`]
        .filter(Boolean)
        .join("\n");
    });
  }

  function normalizedTriples() {
    if (!Array.isArray(store.triples)) return [];
    return store.triples.flatMap((item) => {
      const numbers = Array.isArray(item?.numbers)
        ? item.numbers.map(asRouletteNumber)
        : [];
      const occurrenceCount = asNonNegativeInteger(item?.occurrenceCount, 0);
      if (numbers.length !== 3 || numbers.some((number) => number === null) || occurrenceCount < 2) {
        return [];
      }
      return [{
        numbers,
        occurrenceCount,
        firstOccurredAt: item?.firstOccurredAt || null,
        lastOccurredAt: item?.lastOccurredAt || null
      }];
    });
  }

  function renderTriples() {
    if (!store.triplesLoaded && store.triplesError) {
      elements.triplesCount.textContent = "—";
      elements.triplesCount.title = "Не удалось обновить данные";
      elements.triplesList.replaceChildren(createElement("li", "empty-state", "Не удалось загрузить тройки. Повторим автоматически."));
      elements.triplesList.setAttribute("aria-busy", "false");
      elements.triplesToggle.hidden = true;
      return;
    }

    const items = normalizedTriples();
    const countSuffix = store.triplesHasMore ? "+" : "";
    elements.triplesCount.textContent = store.triplesError
      ? `${items.length}${countSuffix} · не обновлено`
      : `${items.length}${countSuffix} ${pluralForm(items.length, "тройка", "тройки", "троек")}`;
    elements.triplesCount.title = store.triplesError
      ? "Показаны последние успешно загруженные данные; обновить их не удалось"
      : store.triplesHasMore
        ? "Показаны 50 самых частых троек"
        : "";
    elements.triplesList.setAttribute("aria-busy", "false");

    if (!items.length) {
      elements.triplesList.replaceChildren(createElement("li", "empty-state", "Повторяющихся троек пока нет. Покажем их после второго совпадения."));
      elements.triplesToggle.hidden = true;
      return;
    }

    const collapsedLimit = 8;
    const visibleCount = Math.max(collapsedLimit, Math.min(store.triplesVisibleCount, items.length));
    const visibleItems = items.slice(0, visibleCount);
    const fragment = document.createDocumentFragment();

    visibleItems.forEach((item) => {
      const card = createElement("li", "triple-card");
      const main = createElement("div", "triple-card__main");
      const sequence = createElement("div", "triple-card__sequence");
      sequence.setAttribute("aria-hidden", "true");

      item.numbers.forEach((number, index) => {
        if (index > 0) sequence.appendChild(createElement("span", "triple-card__arrow", "→"));
        sequence.appendChild(createElement("span", `history-number triple-card__number ${rouletteColorClass(number)}`, number));
      });

      const count = createElement("span", "triple-card__count", `×${item.occurrenceCount}`);
      count.setAttribute("aria-hidden", "true");
      main.setAttribute("aria-hidden", "true");
      main.append(sequence, count);

      const last = createElement("time", "triple-card__last");
      last.setAttribute("aria-hidden", "true");
      last.dataset.lastOccurredAt = item.lastOccurredAt || "";
      last.dataset.firstOccurredAt = item.firstOccurredAt || "";
      if (item.lastOccurredAt) last.dateTime = item.lastOccurredAt;
      card.dataset.sequenceLabel = item.numbers.join(", затем ");
      card.dataset.occurrenceCount = String(item.occurrenceCount);
      card.append(main, last);
      fragment.appendChild(card);
    });

    elements.triplesList.replaceChildren(fragment);
    const canToggle = items.length > collapsedLimit;
    elements.triplesToggle.hidden = !canToggle;
    elements.triplesToggle.setAttribute("aria-expanded", String(visibleCount > collapsedLimit));
    if (canToggle) {
      const remaining = items.length - visibleCount;
      elements.triplesToggle.textContent = remaining > 0
        ? `Показать ещё ${Math.min(collapsedLimit, remaining)}`
        : "Скрыть";
    }
    updateTripleAges();
  }

  function updateTripleAges() {
    elements.triplesList.querySelectorAll(".triple-card__last").forEach((time) => {
      const card = time.closest(".triple-card");
      if (!card) return;
      const lastOccurredAt = time.dataset.lastOccurredAt || null;
      const firstOccurredAt = time.dataset.firstOccurredAt || null;
      const elapsed = elapsedDuration(lastOccurredAt);
      const occurrenceCount = asNonNegativeInteger(card.dataset.occurrenceCount, 0);
      const countLabel = `${occurrenceCount} ${pluralForm(occurrenceCount, "появление", "появления", "появлений")}`;
      const relative = elapsed === null ? "время неизвестно" : formatElapsedLong(elapsed);

      time.textContent = elapsed === null
        ? "Последний раз: —"
        : `Последний раз: ${formatElapsedCompact(elapsed)} назад`;
      time.title = [
        firstOccurredAt ? `Первое совпадение: ${formatDateTime(firstOccurredAt, { alwaysShowDate: true })}` : "",
        lastOccurredAt ? `Последнее совпадение: ${formatDateTime(lastOccurredAt, { alwaysShowDate: true })}` : ""
      ].filter(Boolean).join("\n");
      card.setAttribute(
        "aria-label",
        `Последовательность: ${card.dataset.sequenceLabel}; ${countLabel}; последнее совпадение ${relative}${lastOccurredAt ? `, ${formatDateTime(lastOccurredAt, { alwaysShowDate: true })}` : ""}`
      );
    });
  }

  function orderedResults(results) {
    return results.slice().sort((left, right) => {
      const leftTime = parseDate(left?.settledAt || left?.observedAt)?.getTime();
      const rightTime = parseDate(right?.settledAt || right?.observedAt)?.getTime();
      if (leftTime === undefined || rightTime === undefined) return 0;
      return rightTime - leftTime;
    });
  }

  function renderResults(results, stats) {
    const items = orderedResults(Array.isArray(results) ? results : []);
    const totalResults = asNonNegativeInteger(stats?.totalResults, items.length);
    elements.resultsCount.textContent = `${totalResults} ${pluralForm(totalResults, "запись", "записи", "записей")}`;

    if (!items.length) {
      elements.resultsBody.replaceChildren(emptyTableRow("Сохранённых выпадений пока нет."));
      return;
    }

    const fragment = document.createDocumentFragment();
    items.forEach((result) => {
      const row = document.createElement("tr");
      const numberCell = document.createElement("td");
      const number = asRouletteNumber(result?.number);

      if (number !== null) {
        const ball = createElement("span", `history-number ${rouletteColorClass(number)}`, number);
        ball.setAttribute("aria-label", `${number}, ${rouletteColorLabel(number)}`);
        numberCell.appendChild(ball);
      } else {
        numberCell.textContent = "—";
      }

      if (result?.wasNew === true) {
        const newMark = createElement("span", "new-mark", "Новое");
        newMark.title = "Число впервые появилось в этом цикле";
        numberCell.appendChild(newMark);
      }

      const timeCell = createElement("td", null, formatDateTime(result?.settledAt || result?.observedAt));
      const priceCell = createElement("td", null, formatPrice(result?.price));
      const roundCell = document.createElement("td");
      const sourceRoundId = result?.roundId ?? result?.externalRoundId ?? null;
      const roundId = createElement("span", "round-id", compactId(sourceRoundId));
      roundId.title = sourceRoundId === null ? "" : String(sourceRoundId);
      roundCell.appendChild(roundId);

      if (result?.cycleId !== undefined && result?.cycleId !== null) {
        roundCell.title = `Цикл ${result.cycleId}`;
      }
      if (Number.isFinite(Number(result?.remainingAfter))) {
        row.title = `После выпадения осталось чисел: ${result.remainingAfter}`;
      }

      row.append(numberCell, timeCell, priceCell, roundCell);
      fragment.appendChild(row);
    });

    elements.resultsBody.replaceChildren(fragment);
  }

  function emptyTableRow(message) {
    const row = createElement("tr", "empty-row");
    const cell = createElement("td", null, message);
    cell.colSpan = 4;
    row.appendChild(cell);
    return row;
  }

  function cycleIsComplete(cycle) {
    const status = String(cycle?.status || "").toLowerCase();
    return ["completed", "complete", "finished", "closed"].includes(status)
      || asRouletteNumber(cycle?.survivorNumber) !== null;
  }

  function renderCycles(cycles, stats) {
    const items = (Array.isArray(cycles) ? cycles : []).filter(cycleIsComplete);
    const completedCycles = asNonNegativeInteger(stats?.completedCycles, items.length);
    elements.cyclesCount.textContent = String(completedCycles);

    if (!items.length) {
      elements.cyclesList.replaceChildren(createElement("li", "empty-state", "Завершённых циклов пока нет."));
      return;
    }

    const fragment = document.createDocumentFragment();
    items.forEach((cycle) => {
      const survivor = asRouletteNumber(cycle?.survivorNumber);
      const item = createElement("li", "cycle-item");
      const ball = createElement(
        "span",
        `cycle-survivor ${survivor === null ? "" : rouletteColorClass(survivor)}`.trim(),
        survivor === null ? "—" : survivor
      );
      ball.setAttribute("aria-label", survivor === null ? "Оставшееся число не указано" : `Оставшееся число ${survivor}, ${rouletteColorLabel(survivor)}`);

      const copy = createElement("span", "cycle-item__copy");
      const title = createElement("strong", null, cycle?.id === undefined || cycle?.id === null ? "Завершённый цикл" : `Цикл ${compactId(cycle.id)}`);
      title.title = cycle?.id === undefined || cycle?.id === null ? "" : String(cycle.id);
      const period = createElement("span", null, formatCyclePeriod(cycle?.startedAt, cycle?.completedAt));
      copy.append(title, period);

      const integrity = String(cycle?.integrityStatus || "").toLowerCase();
      if (integrity && !["ok", "complete", "valid", "verified"].includes(integrity)) {
        const integrityLabel = createElement("span", "integrity-warning", "Неполные данные");
        copy.appendChild(integrityLabel);
      }

      const draws = createElement("span", "cycle-item__draws");
      const totalDraws = asNonNegativeInteger(cycle?.totalDraws, 0);
      draws.append(
        createElement("strong", null, totalDraws),
        createElement("span", null, pluralForm(totalDraws, "ход", "хода", "ходов"))
      );

      item.append(ball, copy, draws);
      fragment.appendChild(item);
    });

    elements.cyclesList.replaceChildren(fragment);
  }

  function updateLastSync() {
    if (!store.lastSyncAt) {
      elements.lastSync.textContent = "Данные ещё не синхронизированы";
      elements.lastSync.removeAttribute("title");
      return;
    }
    elements.lastSync.textContent = `Синхронизация ${formatRelative(store.lastSyncAt)}`;
    elements.lastSync.title = new Intl.DateTimeFormat("ru-RU", {
      dateStyle: "medium",
      timeStyle: "medium"
    }).format(store.lastSyncAt);
  }

  function scheduleRefresh() {
    window.clearTimeout(store.refreshTimer);
    store.refreshTimer = window.setTimeout(() => refreshAll(), 180);
  }

  function connectEventStream() {
    if (!("EventSource" in window)) {
      setConnection("offline", "Без live-подключения");
      return;
    }

    if (store.eventSource) store.eventSource.close();
    setConnection("connecting", "Подключение к эфиру…");

    const source = new EventSource("/api/events");
    store.eventSource = source;

    source.addEventListener("open", () => {
      setConnection("online", "Онлайн");
    });

    source.addEventListener("update", (event) => {
      let reason = "";
      try {
        reason = JSON.parse(event.data || "{}").reason || "";
      } catch {
        reason = "";
      }
      if (reason === "gap") announce("Обнаружен пропуск в истории результатов");
      scheduleRefresh();
    });

    source.addEventListener("message", scheduleRefresh);

    source.addEventListener("error", () => {
      if (source.readyState === EventSource.CLOSED) {
        setConnection("offline", "Эфир отключён");
      } else {
        setConnection("connecting", "Переподключение…");
      }
    });
  }

  elements.refreshButton.addEventListener("click", () => refreshAll({ notify: true }));
  elements.riskRounds.addEventListener("input", renderRiskCalculator);
  elements.triplesToggle.addEventListener("click", () => {
    const total = normalizedTriples().length;
    store.triplesVisibleCount = store.triplesVisibleCount >= total
      ? 8
      : Math.min(total, store.triplesVisibleCount + 8);
    renderTriples();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") refreshAll();
  });
  window.addEventListener("beforeunload", () => store.eventSource?.close());

  renderNumberGrid(null);
  renderRiskCalculator();
  connectEventStream();
  refreshAll();
  window.setInterval(() => refreshAll(), REFRESH_INTERVAL_MS);
  window.setInterval(() => {
    updateLastSync();
    updateNumberAges();
    updateOverdueAges();
    updateTripleAges();
  }, AGE_UPDATE_INTERVAL_MS);
})();
