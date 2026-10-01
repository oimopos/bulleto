import { BET_RISK_MODEL, calculateBetRisk } from "./risk-calculator.js?v=2";
import { buildFollowerStats } from "./pair-followers.js?v=1";

(() => {
  "use strict";

  const RED_NUMBERS = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
  const ALL_NUMBERS = Array.from({ length: 37 }, (_, number) => number);
  const REFRESH_INTERVAL_MS = 45_000;
  const AGE_UPDATE_INTERVAL_MS = 30_000;
  const FOLLOWER_COLLAPSED_LIMIT = 5;
  const FOLLOWER_HIT_HORIZONS = [1, 2, 3, 5, 10, 20];

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
    preclosePanel: document.getElementById("preclose-panel"),
    precloseBadge: document.getElementById("preclose-badge"),
    precloseStatus: document.getElementById("preclose-status"),
    precloseRanking: document.getElementById("preclose-ranking"),
    precloseTiming: document.getElementById("preclose-timing"),
    precloseLivePrice: document.getElementById("preclose-live-price"),
    precloseProjectedPrice: document.getElementById("preclose-projected-price"),
    precloseSampleCount: document.getElementById("preclose-sample-count"),
    precloseTop3Rate: document.getElementById("preclose-top3-rate"),
    precloseComparison: document.getElementById("preclose-comparison"),
    precloseComparisonBadge: document.getElementById("preclose-comparison-badge"),
    precloseComparisonStatus: document.getElementById("preclose-comparison-status"),
    precloseComparisonWarning: document.getElementById("preclose-comparison-warning"),
    precloseHitHistory: document.getElementById("preclose-hit-history"),
    precloseHitHistoryCount: document.getElementById("preclose-hit-history-count"),
    precloseHitHistoryList: document.getElementById("preclose-hit-history-list"),
    precloseHitHistoryStatus: document.getElementById("preclose-hit-history-status"),
    followerPanel: document.getElementById("follower-panel"),
    followerTitle: document.getElementById("follower-title"),
    followerLive: document.getElementById("follower-live-tracker"),
    followerLiveStatus: document.getElementById("follower-live-status"),
    followerLiveSource: document.getElementById("follower-live-source"),
    followerLiveFixedList: document.getElementById("follower-live-fixed-list"),
    followerLiveLockMeta: document.getElementById("follower-live-lock-meta"),
    followerLiveCurrentAttempt: document.getElementById("follower-live-current-attempt"),
    followerLiveAttemptSummary: document.getElementById("follower-live-attempt-summary"),
    followerLiveHistoryRate: document.getElementById("follower-live-history-rate"),
    followerLiveHistoryDetail: document.getElementById("follower-live-history-detail"),
    followerLiveAttemptList: document.getElementById("follower-live-attempt-list"),
    followerLiveLastHit: document.getElementById("follower-live-last-hit"),
    followerSource: document.getElementById("follower-source"),
    followerCount: document.getElementById("follower-count"),
    followerList: document.getElementById("follower-list"),
    followerHorizon: document.getElementById("follower-horizon"),
    followerHorizonList: document.getElementById("follower-horizon-list"),
    followerHorizonStatus: document.getElementById("follower-horizon-status"),
    followerDescription: document.getElementById("follower-description"),
    followerNote: document.getElementById("follower-note"),
    followerToggle: document.getElementById("follower-toggle"),
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
    pairs: [],
    followerHitCurve: null,
    pairsLoaded: false,
    pairsError: false,
    forecastHits: [],
    forecastHitsLoaded: false,
    forecastHitsError: false,
    forecastHitsHasMore: false,
    followerSourceNumber: null,
    followerSourceLocked: false,
    followerVisibleCount: FOLLOWER_COLLAPSED_LIMIT,
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

  function initializeFollowerSource() {
    const fragment = document.createDocumentFragment();
    ALL_NUMBERS.forEach((number) => {
      const option = createElement("option", null, number);
      option.value = String(number);
      fragment.appendChild(option);
    });
    elements.followerSource.replaceChildren(fragment);
    elements.followerSource.disabled = true;
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
      fetchJson("/api/sequences?limit=50"),
      fetchJson("/api/pairs"),
      fetchJson("/api/forecasts/hits?limit=20")
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
    if (requests[4].status === "fulfilled") {
      store.pairs = extractItems(requests[4].value);
      store.followerHitCurve = requests[4].value?.top5HitByHorizon ?? null;
      store.pairsLoaded = true;
      store.pairsError = false;
      successfulRequests += 1;
    } else {
      store.pairsError = true;
    }
    if (requests[5].status === "fulfilled") {
      store.forecastHits = extractItems(requests[5].value);
      store.forecastHitsHasMore = requests[5].value?.hasMore === true;
      store.forecastHitsLoaded = true;
      store.forecastHitsError = false;
      successfulRequests += 1;
    } else {
      store.forecastHitsError = true;
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
      elements.followerList.replaceChildren(createElement("li", "empty-state", "Не удалось загрузить исторические переходы. Повторим автоматически."));
      elements.followerList.setAttribute("aria-busy", "false");
      elements.followerCount.textContent = "— · ошибка";
      elements.followerCount.title = "Не удалось загрузить исторические переходы";
      elements.followerToggle.hidden = true;
      elements.overdueList.replaceChildren(createElement("li", "empty-state", "Не удалось рассчитать давность выпадений."));
      elements.overdueList.setAttribute("aria-busy", "false");
      elements.collectorCard.dataset.state = "error";
      elements.collectorStatus.textContent = "Нет связи с сервером";
      elements.boardNote.textContent = "Не удалось получить состояние активного цикла.";
    }
    if (store.hasCompletedInitialRender) {
      renderFollowers(store.state?.latestResult || store.results[0] || null);
    }
    renderFollowerTop5Tracker(store.state?.followerTop5Tracker || null);
    renderFollowerHitCurve();
    renderForecastHitHistory();
    renderVirtualBettor(store.state?.virtualBettor || null);
  }

  function renderAll() {
    const latestResult = store.state?.latestResult || store.results[0] || null;
    renderCollector(store.state?.collector);
    renderGapWarning(store.state);
    renderLatestResult(latestResult);
    renderPrecloseForecast();
    renderForecastHitHistory();
    renderFollowerTop5Tracker(store.state?.followerTop5Tracker || null);
    renderFollowers(latestResult);
    renderOverdueNumbers();
    renderActiveCycle(store.state?.activeCycle || null);
    renderTriples();
    renderResults(store.results, store.state?.stats);
    renderCycles(store.cycles, store.state?.stats);
    renderVirtualBettor(store.state?.virtualBettor || null);
    updateLastSync();
    store.hasCompletedInitialRender = true;
  }

  function uniqueComparisonNumbers(value) {
    if (!Array.isArray(value)) return [];
    const numbers = value.map(asRouletteNumber);
    if (numbers.some((number) => number === null)) return [];
    if (new Set(numbers).size !== numbers.length) return [];
    return numbers;
  }

  function setComparisonWarning(messages) {
    const warning = messages.filter(Boolean).join(" ");
    elements.precloseComparisonWarning.hidden = warning === "";
    elements.precloseComparisonWarning.textContent = warning;
  }

  function normalizedForecastTop3(value) {
    if (!Array.isArray(value) || value.length !== 3) return [];
    const numbers = uniqueComparisonNumbers(value);
    return numbers.length === 3 ? numbers : [];
  }

  function resolveFinalForecast(latest) {
    const consensus = latest?.consensus;
    const hasConsensus = consensus !== null
      && typeof consensus === "object"
      && !Array.isArray(consensus);

    if (hasConsensus) {
      const status = String(consensus.status || "");
      const numbers = normalizedForecastTop3(consensus.top3);
      const validStatus = ["combined", "model_fallback", "pair_fallback"].includes(status);
      if (validStatus && numbers.length === 3) {
        return {
          numbers,
          status,
          pairSampleSize: asOptionalNonNegativeInteger(consensus.pairSampleSize),
          derivedFromSnapshotAt: consensus.derivedFromSnapshotAt || null,
          legacy: false,
        };
      }
      return {
        numbers: [],
        status: "unavailable",
        pairSampleSize: asOptionalNonNegativeInteger(consensus.pairSampleSize),
        derivedFromSnapshotAt: consensus.derivedFromSnapshotAt || null,
        legacy: false,
      };
    }

    const legacyNumbers = normalizedForecastTop3(latest?.rankedNumbers);
    return {
      numbers: legacyNumbers,
      status: legacyNumbers.length === 3 ? "model_fallback" : "unavailable",
      pairSampleSize: null,
      derivedFromSnapshotAt: null,
      legacy: legacyNumbers.length === 3,
    };
  }

  function renderPrecloseComparison(latest, finalForecast = resolveFinalForecast(latest)) {
    elements.precloseComparison.removeAttribute("title");
    setComparisonWarning([]);

    if (!latest) {
      elements.precloseComparison.dataset.state = "waiting";
      elements.precloseComparison.setAttribute("aria-busy", "true");
      elements.precloseComparisonBadge.textContent = "Ждём прогноз";
      setTextIfChanged(
        elements.precloseComparisonStatus,
        "Источники будут сопоставлены после фиксации прогноза.",
      );
      return;
    }

    const { status, pairSampleSize, derivedFromSnapshotAt, legacy } = finalForecast;
    if (status === "unavailable") {
      elements.precloseComparison.dataset.state = "unavailable";
      elements.precloseComparison.setAttribute("aria-busy", "false");
      elements.precloseComparisonBadge.textContent = "Нет итогового списка";
      setTextIfChanged(
        elements.precloseComparisonStatus,
        "Сохранённый сводный прогноз недоступен или неполон.",
      );
      return;
    }

    elements.precloseComparison.dataset.state = "ready";
    elements.precloseComparison.setAttribute("aria-busy", "false");
    const warnings = [];
    if (status === "combined") {
      elements.precloseComparisonBadge.textContent = "2 источника";
      const sampleText = pairSampleSize === null
        ? ""
        : ` История: ${pairSampleSize} ${pluralForm(pairSampleSize, "переход", "перехода", "переходов")}.`;
      setTextIfChanged(
        elements.precloseComparisonStatus,
        `2 источника сопоставлены: ценовая модель и история переходов.${sampleText}`,
      );
      if (pairSampleSize !== null && pairSampleSize < 30) {
        warnings.push(`Очень малая историческая выборка: ${pairSampleSize} ${pluralForm(pairSampleSize, "переход", "перехода", "переходов")}.`);
      } else if (pairSampleSize !== null && pairSampleSize < 100) {
        warnings.push(`Мало исторических данных: ${pairSampleSize} переходов. Трактуйте итог осторожно.`);
      }
    } else if (status === "pair_fallback") {
      elements.precloseComparisonBadge.textContent = "1 источник";
      const sampleText = pairSampleSize === null
        ? ""
        : ` Выборка: ${pairSampleSize} ${pluralForm(pairSampleSize, "переход", "перехода", "переходов")}.`;
      setTextIfChanged(
        elements.precloseComparisonStatus,
        `Итог сформирован только по истории переходов: ценовая модель недоступна.${sampleText}`,
      );
    } else {
      elements.precloseComparisonBadge.textContent = "1 источник";
      setTextIfChanged(
        elements.precloseComparisonStatus,
        legacy
          ? "Показан ценовой top‑3 старого прогноза: сводный снимок для него ещё не сохранялся."
          : "Итог сформирован только ценовой моделью: история переходов недоступна.",
      );
    }
    setComparisonWarning(warnings);

    if (derivedFromSnapshotAt) {
      elements.precloseComparison.title = `Сводный список рассчитан по снимку от ${formatDateTime(derivedFromSnapshotAt, { alwaysShowDate: true })}`;
    }
  }

  function normalizeForecastHit(value) {
    const rankedNumbers = Array.isArray(value?.rankedNumbers)
      ? value.rankedNumbers.map(asRouletteNumber)
      : [];
    const actualNumber = asRouletteNumber(value?.actualNumber);

    if (
      rankedNumbers.length !== 3
      || rankedNumbers.some((number) => number === null)
      || new Set(rankedNumbers).size !== 3
      || actualNumber === null
      || !rankedNumbers.includes(actualNumber)
    ) {
      return null;
    }

    return {
      roundId: value?.roundId,
      rankedNumbers,
      actualNumber,
      lockedAt: value?.lockedAt,
      settledAt: value?.settledAt,
      modelVersion: value?.modelVersion
    };
  }

  function forecastHitPick(number, rank, actualNumber) {
    const isHit = number === actualNumber;
    const item = createElement("li", `preclose-hit-card__pick${isHit ? " is-hit" : ""}`);
    const rankLabel = createElement("span", "preclose-hit-card__rank", `#${rank}`);
    rankLabel.setAttribute("aria-hidden", "true");

    const ball = createElement(
      "span",
      `preclose-hit-card__number ${rouletteColorClass(number)}`,
      number,
    );
    ball.setAttribute("aria-hidden", "true");

    item.append(
      rankLabel,
      ball,
      createElement("span", "sr-only", `${rank} место: число ${number}, ${rouletteColorLabel(number)}${isHit ? ", совпало с результатом" : ""}`),
    );
    return item;
  }

  function forecastHitCard(hit) {
    const card = createElement("li", "preclose-hit-card");
    const sequence = createElement("div", "preclose-hit-card__sequence");
    const ranking = createElement("ol", "preclose-hit-card__ranking");
    ranking.setAttribute("aria-label", "Зафиксированный ценовой top-3");
    hit.rankedNumbers.forEach((number, index) => {
      ranking.appendChild(forecastHitPick(number, index + 1, hit.actualNumber));
    });

    const arrow = createElement("span", "preclose-hit-card__arrow", "→");
    arrow.setAttribute("aria-hidden", "true");

    const outcome = createElement("div", "preclose-hit-card__outcome");
    const outcomeLabel = createElement("span", "preclose-hit-card__outcome-label", "выпало");
    const actualBall = createElement(
      "span",
      `preclose-hit-card__actual ${rouletteColorClass(hit.actualNumber)}`,
      hit.actualNumber,
    );
    actualBall.setAttribute("aria-hidden", "true");
    outcome.append(
      outcomeLabel,
      actualBall,
      createElement("span", "sr-only", `Выпало число ${hit.actualNumber}, ${rouletteColorLabel(hit.actualNumber)}; попадание подтверждено`),
    );

    sequence.append(ranking, arrow, outcome);

    const meta = createElement("p", "preclose-hit-card__meta");
    const fullRoundId = hit.roundId === null || hit.roundId === undefined || hit.roundId === ""
      ? ""
      : String(hit.roundId);
    const round = createElement("span", "preclose-hit-card__round", `Раунд ${compactId(hit.roundId)}`);
    if (fullRoundId) round.title = `Раунд ${fullRoundId}`;
    meta.appendChild(round);

    const eventAt = hit.settledAt || hit.lockedAt;
    const eventDate = parseDate(eventAt);
    if (eventDate) {
      const time = createElement("time", "preclose-hit-card__time", formatDateTime(eventDate, { alwaysShowDate: true }));
      const fullDate = new Intl.DateTimeFormat("ru-RU", {
        dateStyle: "long",
        timeStyle: "medium"
      }).format(eventDate);
      time.dateTime = eventDate.toISOString();
      time.title = fullDate;
      time.setAttribute("aria-label", `${hit.settledAt ? "Результат зафиксирован" : "Прогноз зафиксирован"}: ${fullDate}`);
      meta.appendChild(time);
    }

    const modelVersion = hit.modelVersion === null || hit.modelVersion === undefined
      ? ""
      : String(hit.modelVersion).trim();
    if (modelVersion) {
      const model = createElement("span", "preclose-hit-card__model", `Модель ${modelVersion}`);
      model.title = `Версия модели: ${modelVersion}`;
      meta.appendChild(model);
    }

    card.append(sequence, meta);
    return card;
  }

  function renderForecastHitHistory() {
    const history = elements.precloseHitHistory;
    const list = elements.precloseHitHistoryList;

    if (!store.forecastHitsLoaded) {
      history.dataset.state = store.forecastHitsError ? "error" : "loading";
      history.setAttribute("aria-busy", store.forecastHitsError ? "false" : "true");
      elements.precloseHitHistoryCount.textContent = store.forecastHitsError ? "Ошибка" : "Загрузка…";
      list.replaceChildren(createElement(
        "li",
        "empty-state",
        store.forecastHitsError
          ? "Не удалось загрузить историю попаданий."
          : "Загружаем историю попаданий…",
      ));
      setTextIfChanged(
        elements.precloseHitHistoryStatus,
        store.forecastHitsError
          ? "Повторим загрузку автоматически."
          : "Загружаем сохранённые прогнозы ценовой модели с подтверждённым результатом; это наблюдение, не реальные ставки.",
      );
      return;
    }

    const hits = store.forecastHits
      .map(normalizeForecastHit)
      .filter((item) => item !== null)
      .slice(0, 20);

    history.setAttribute("aria-busy", "false");
    if (!hits.length) {
      history.dataset.state = store.forecastHitsError ? "error" : "empty";
      elements.precloseHitHistoryCount.textContent = store.forecastHitsError ? "Ошибка" : "0 попаданий";
      list.replaceChildren(createElement(
        "li",
        "empty-state",
        store.forecastHitsError
          ? "Не удалось обновить историю попаданий."
          : "Подтверждённых попаданий ценового top-3 пока нет.",
      ));
      setTextIfChanged(
        elements.precloseHitHistoryStatus,
        store.forecastHitsError
          ? "Повторим загрузку автоматически."
          : "Первое подтверждённое попадание ценовой модели появится здесь после проверки результата; это наблюдение, не реальные ставки.",
      );
      return;
    }

    const fragment = document.createDocumentFragment();
    hits.forEach((hit) => fragment.appendChild(forecastHitCard(hit)));
    list.replaceChildren(fragment);

    const hitLabel = pluralForm(hits.length, "попадание", "попадания", "попаданий");
    if (store.forecastHitsError) {
      history.dataset.state = "stale";
      elements.precloseHitHistoryCount.textContent = `${hits.length} · не обновлено`;
      setTextIfChanged(
        elements.precloseHitHistoryStatus,
        `Показаны последние загруженные ${hits.length} ${hitLabel} ценовой модели; свежие данные временно недоступны. Это наблюдение, не реальные ставки.`,
      );
      return;
    }

    history.dataset.state = "ready";
    elements.precloseHitHistoryCount.textContent = store.forecastHitsHasMore
      ? `${hits.length} последних`
      : `${hits.length} ${hitLabel}`;
    setTextIfChanged(
      elements.precloseHitHistoryStatus,
      store.forecastHitsHasMore
        ? `Показаны ${hits.length} последних ${hitLabel} ценовой модели; более ранние записи остаются в истории. Это наблюдение, не реальные ставки.`
        : `Показаны все ${hits.length} ${hitLabel} ценовой модели на данный момент. Это наблюдение, не реальные ставки.`,
    );
  }

  function renderPrecloseForecast() {
    const forecastState = store.state?.precloseForecast || null;
    const latest = forecastState?.latest || null;
    const metrics = forecastState?.metrics || {};
    const currentRound = store.state?.collector?.currentRound || null;
    const currentRoundId = currentRound?.id == null ? null : String(currentRound.id);
    const latestRoundId = latest?.roundId == null ? null : String(latest.roundId);
    const closesAt = currentRound?.bettingClosesAt || currentRound?.closesAt || null;
    const closesMs = parseDate(closesAt)?.getTime() ?? null;
    const nowMs = currentTimeMs();
    const secondsUntilClose = closesMs === null
      ? null
      : Math.max(0, Math.ceil((closesMs - nowMs) / 1_000));
    const matchesCurrent = latest !== null
      && currentRoundId !== null
      && latestRoundId === currentRoundId;
    const settledCount = asNonNegativeInteger(metrics.settledCount, 0);
    const forecastCount = asNonNegativeInteger(metrics.forecastCount, settledCount);
    const pendingCount = asNonNegativeInteger(metrics.pendingCount, Math.max(0, forecastCount - settledCount));
    const top3Hits = asNonNegativeInteger(metrics.top3Hits, 0);
    const top3Rate = Number(metrics.top3Rate);
    const finalForecast = resolveFinalForecast(matchesCurrent ? latest : null);

    elements.precloseSampleCount.textContent = settledCount < 100
      ? `${settledCount} из 100`
      : `${settledCount} проверено`;
    elements.precloseSampleCount.title = `Ценовая модель: зафиксировано ${forecastCount}; ожидают результата ${pendingCount}`;
    elements.precloseTop3Rate.textContent = settledCount >= 100 && Number.isFinite(top3Rate)
      ? `${top3Hits} из ${settledCount} · ${(top3Rate * 100).toFixed(1).replace(".", ",")}%`
      : `${top3Hits} из ${settledCount} · мало данных`;
    renderPrecloseComparison(matchesCurrent ? latest : null, finalForecast);

    if (!matchesCurrent) {
      elements.precloseRanking.setAttribute("aria-busy", "true");
      elements.precloseRanking.replaceChildren(
        createElement("li", "empty-state", "Прогноз этого раунда ещё не зафиксирован."),
      );
      elements.precloseLivePrice.textContent = "—";
      elements.precloseProjectedPrice.textContent = "—";

      if (closesMs === null || currentRoundId === null) {
        elements.preclosePanel.dataset.state = "waiting";
        elements.precloseBadge.textContent = "Ждём раунд";
        elements.precloseStatus.textContent = "Собираем живую цену до блокировки ставок.";
        elements.precloseTiming.textContent = "Фиксация выполняется примерно за 8–10 секунд до bcd.";
        return;
      }

      if (nowMs < closesMs - 10_000) {
        const secondsToCapture = Math.max(1, Math.ceil((closesMs - 10_000 - nowMs) / 1_000));
        elements.preclosePanel.dataset.state = "waiting";
        elements.precloseBadge.textContent = `Открыто · ${secondsUntilClose}с`;
        elements.precloseStatus.textContent = `Раунд ${compactId(currentRoundId)}: цена поступает, прогноз ещё не зафиксирован.`;
        elements.precloseTiming.textContent = `До окна фиксации примерно ${secondsToCapture} сек.`;
      } else if (nowMs < closesMs) {
        elements.preclosePanel.dataset.state = "capturing";
        elements.precloseBadge.textContent = `Открыто · ${secondsUntilClose}с`;
        elements.precloseStatus.textContent = "Фиксируем последний допустимый ценовой снимок…";
        elements.precloseTiming.textContent = "Будут использованы только данные, полученные до bcd.";
      } else {
        elements.preclosePanel.dataset.state = "locked";
        elements.precloseBadge.textContent = "Ставки закрыты";
        elements.precloseStatus.textContent = "Красная линия пройдена. Для этого раунда новый прогноз уже не создаётся.";
        elements.precloseTiming.textContent = "Пропущенный снимок задним числом не восстанавливается.";
      }
      return;
    }

    const rankedNumbers = finalForecast.numbers;
    const rankingLabel = finalForecast.legacy
      ? "Ценовой список старого прогноза"
      : "Итоговый список";
    const ranking = rankedNumbers.map((number, index) => {
      const item = createElement("li", "preclose-pick");
      item.setAttribute(
        "aria-label",
        `${rankingLabel}, ${index + 1} место: число ${number}, ${rouletteColorLabel(number)}`,
      );
      item.append(
        createElement("span", "preclose-pick__rank", `#${index + 1}`),
      );
      const ball = createElement(
        "span",
        `preclose-pick__number ${rouletteColorClass(number)}`,
        number,
      );
      ball.setAttribute("aria-hidden", "true");
      item.append(ball);
      if (latest.settlement) {
        const actual = asRouletteNumber(latest.settlement.actualNumber);
        const marker = createElement(
          "span",
          `preclose-pick__result${actual === number ? " is-hit" : ""}`,
          actual === number ? "совпало" : "",
        );
        item.append(marker);
      }
      return item;
    });
    elements.precloseRanking.replaceChildren(
      ...(ranking.length
        ? ranking
        : [createElement("li", "empty-state", "Итоговый top‑3 недоступен.")]),
    );
    elements.precloseRanking.setAttribute("aria-busy", "false");
    elements.precloseLivePrice.textContent = Number.isFinite(Number(latest.currentPrice))
      ? Number(latest.currentPrice).toFixed(5)
      : "—";
    elements.precloseProjectedPrice.textContent = Number.isFinite(Number(latest.projectedPrice))
      ? Number(latest.projectedPrice).toFixed(5)
      : "—";
    const availableLead = Number(latest.availableLeadSeconds);
    const availableLeadText = Number.isFinite(availableLead)
      ? `${availableLead.toFixed(1).replace(".", ",")} сек.`
      : "неизвестно";
    elements.precloseTiming.textContent = `Цена получена ${formatDateTime(latest.lockedAt)}, запись сохранена ${formatDateTime(latest.persistedAt)} · за ${availableLeadText} до bcd.`;

    if (latest.settlement) {
      const actual = asRouletteNumber(latest.settlement.actualNumber);
      if (rankedNumbers.length !== 3) {
        elements.preclosePanel.dataset.state = "locked";
        elements.precloseBadge.textContent = "Итог недоступен";
        elements.precloseStatus.textContent = `Раунд ${compactId(latestRoundId)} проверен: выпало ${actual ?? "—"}. Сопоставить результат с итоговым списком нельзя.`;
        return;
      }
      const finalHit = actual !== null && rankedNumbers.includes(actual);
      elements.preclosePanel.dataset.state = finalHit ? "hit" : "miss";
      elements.precloseBadge.textContent = finalForecast.legacy
        ? "Ценовой список · справочно"
        : finalHit
          ? "Совпадение · справочно"
          : "Проверено · справочно";
      const listLabel = finalForecast.legacy ? "ценового списка" : "итогового списка";
      const comparisonText = finalHit
        ? `Совпадение ${listLabel} (справочно).`
        : `Совпадения с ${listLabel} нет (справочно).`;
      elements.precloseStatus.textContent = `Раунд ${compactId(latestRoundId)} проверен: выпало ${actual ?? "—"}. ${comparisonText}`;
    } else if (closesMs !== null && nowMs < closesMs) {
      elements.preclosePanel.dataset.state = "open";
      elements.precloseBadge.textContent = `Открыто · ${secondsUntilClose}с`;
      elements.precloseStatus.textContent = `Раунд ${compactId(latestRoundId)}: прогноз уже зафиксирован, ставки пока открыты.`;
    } else {
      elements.preclosePanel.dataset.state = "locked";
      elements.precloseBadge.textContent = "Ставки закрыты";
      elements.precloseStatus.textContent = `Раунд ${compactId(latestRoundId)}: прогноз сохранён, но красная линия уже пройдена. Ждём результат.`;
    }
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

  const historicalPercentFormatter = new Intl.NumberFormat("ru-RU", {
    style: "percent",
    minimumFractionDigits: 0,
    maximumFractionDigits: 1
  });

  function normalizedFollowerHitCurve() {
    const curve = store.followerHitCurve;
    if (
      curve?.schemaVersion !== 1
      || curve?.algorithmVersion !== "follower-top5-walk-forward-v1"
      || curve?.topCount !== 5
      || curve?.minimumObservedFollowerCount !== 5
      || curve?.evaluationMode !== "saved-sequence-retrospective"
      || curve?.maximumHorizonRounds !== 20
      || curve?.cohort !== "anchors-with-complete-20-round-window"
      || !Array.isArray(curve?.horizons)
      || curve.horizons.length !== FOLLOWER_HIT_HORIZONS.length
      || curve.horizons.some((horizon, index) => horizon !== FOLLOWER_HIT_HORIZONS[index])
    ) {
      return null;
    }
    const points = Array.isArray(curve?.overall?.points)
      ? curve.overall.points
      : [];
    const byHorizon = new Map();
    let invalidPoint = points.length !== FOLLOWER_HIT_HORIZONS.length;

    points.forEach((point) => {
      const horizon = asOptionalNonNegativeInteger(point?.horizon);
      const hitCount = asOptionalNonNegativeInteger(point?.hitCount);
      const eligibleCount = asOptionalNonNegativeInteger(point?.eligibleCount);
      if (
        !FOLLOWER_HIT_HORIZONS.includes(horizon)
        || hitCount === null
        || eligibleCount === null
        || hitCount > eligibleCount
      ) {
        invalidPoint = true;
        return;
      }
      if (byHorizon.has(horizon)) {
        invalidPoint = true;
        return;
      }
      byHorizon.set(horizon, { horizon, hitCount, eligibleCount });
    });

    if (
      invalidPoint
      || FOLLOWER_HIT_HORIZONS.some((horizon) => !byHorizon.has(horizon))
    ) {
      return null;
    }
    const normalized = FOLLOWER_HIT_HORIZONS.map((horizon) => byHorizon.get(horizon));
    const eligibleCount = normalized[0].eligibleCount;
    if (
      asOptionalNonNegativeInteger(curve?.overall?.eligibleCount) !== eligibleCount
      || normalized.some((point) => point.eligibleCount !== eligibleCount)
      || normalized.some((point, index) =>
        index > 0 && point.hitCount < normalized[index - 1].hitCount)
    ) {
      return null;
    }
    return { eligibleCount, points: normalized };
  }

  function normalizedFollowerAllPoints() {
    const summary = normalizedFollowerHitCurve();
    const points = store.followerHitCurve?.overall?.allPoints;
    if (!summary || !Array.isArray(points) || points.length !== 20) return null;

    const normalized = [];
    let previousHitCount = -1;
    for (let index = 0; index < points.length; index += 1) {
      const point = points[index];
      const horizon = asOptionalNonNegativeInteger(point?.horizon);
      const hitCount = asOptionalNonNegativeInteger(point?.hitCount);
      const eligibleCount = asOptionalNonNegativeInteger(point?.eligibleCount);
      const expectedHorizon = index + 1;
      if (
        horizon !== expectedHorizon
        || hitCount === null
        || eligibleCount !== summary.eligibleCount
        || hitCount > eligibleCount
        || hitCount < previousHitCount
      ) {
        return null;
      }

      let rate = null;
      if (eligibleCount === 0) {
        if (hitCount !== 0 || point?.rate !== null) return null;
      } else {
        rate = asOptionalFiniteNumber(point?.rate);
        const expectedRate = hitCount / eligibleCount;
        if (
          rate === null
          || rate < 0
          || rate > 1
          || Math.abs(rate - expectedRate) > 1e-12
        ) {
          return null;
        }
      }

      normalized.push({ horizon, hitCount, eligibleCount, rate });
      previousHitCount = hitCount;
    }

    const sparsePoints = new Map(summary.points.map((point) => [point.horizon, point]));
    if (FOLLOWER_HIT_HORIZONS.some((horizon) => {
      const sparse = sparsePoints.get(horizon);
      const complete = normalized[horizon - 1];
      return sparse.hitCount !== complete.hitCount
        || sparse.eligibleCount !== complete.eligibleCount;
    })) {
      return null;
    }

    return { eligibleCount: summary.eligibleCount, points: normalized };
  }

  function normalizedFollowerFixedNumbers(value) {
    if (!Array.isArray(value) || value.length !== 5) return null;
    const numbers = value.map(asRouletteNumber);
    if (numbers.some((number) => number === null) || new Set(numbers).size !== 5) return null;
    return numbers;
  }

  function normalizedFollowerLiveSession(value, status) {
    if (!value || typeof value !== "object") return null;
    const id = asOptionalNonNegativeInteger(value.id);
    const continuityEpoch = asOptionalNonNegativeInteger(value.continuityEpoch);
    const sourceNumber = asRouletteNumber(value.sourceNumber);
    const fixedNumbers = normalizedFollowerFixedNumbers(value.fixedNumbers);
    const anchorResultId = asOptionalNonNegativeInteger(value.anchor?.resultId);
    const anchorNumber = asRouletteNumber(value.anchor?.number);
    const sampleSize = asOptionalNonNegativeInteger(value.sampleSize);
    const observedFollowerCount = asOptionalNonNegativeInteger(value.observedFollowerCount);
    const attemptCount = asOptionalNonNegativeInteger(value.attemptCount);
    const missCount = asOptionalNonNegativeInteger(value.missCount);
    const nextAttemptNumber = asOptionalNonNegativeInteger(value.nextAttemptNumber);
    const attempts = Array.isArray(value.attempts) ? value.attempts : null;

    if (
      id === null || id < 1
      || continuityEpoch === null
      || sourceNumber === null
      || fixedNumbers === null
      || anchorResultId === null || anchorResultId < 1
      || anchorNumber !== sourceNumber
      || !parseDate(value.anchor?.settledAt)
      || !parseDate(value.lockedAt)
      || sampleSize === null
      || observedFollowerCount === null
      || observedFollowerCount < 5
      || observedFollowerCount > sampleSize
      || attemptCount === null
      || missCount !== attemptCount
      || nextAttemptNumber !== attemptCount + 1
      || attempts === null
      || typeof value.attemptsTruncated !== "boolean"
      || value.attemptsTruncated !== (attemptCount > 100)
      || attempts.length !== Math.min(attemptCount, 100)
      || (status === "armed" && attemptCount !== 0)
      || (status === "active" && attemptCount < 1)
    ) {
      return null;
    }

    const firstVisibleAttempt = attemptCount - attempts.length + 1;
    const seenResultIds = new Set();
    const normalizedAttempts = [];
    for (let index = 0; index < attempts.length; index += 1) {
      const attempt = attempts[index];
      const attemptNumber = asOptionalNonNegativeInteger(attempt?.attemptNumber);
      const resultId = asOptionalNonNegativeInteger(attempt?.resultId);
      const resultNumber = asRouletteNumber(attempt?.resultNumber);
      if (
        attemptNumber !== firstVisibleAttempt + index
        || resultId === null || resultId < 1
        || seenResultIds.has(resultId)
        || resultNumber === null
        || fixedNumbers.includes(resultNumber)
        || attempt?.outcome !== "miss"
        || attempt?.hitRank !== null
        || !parseDate(attempt?.settledAt)
      ) {
        return null;
      }
      seenResultIds.add(resultId);
      normalizedAttempts.push({
        attemptNumber,
        resultId,
        resultNumber,
        settledAt: attempt.settledAt
      });
    }

    return {
      id,
      continuityEpoch,
      sourceNumber,
      fixedNumbers,
      anchor: {
        resultId: anchorResultId,
        number: anchorNumber,
        settledAt: value.anchor.settledAt
      },
      lockedAt: value.lockedAt,
      sampleSize,
      observedFollowerCount,
      attemptCount,
      missCount,
      nextAttemptNumber,
      attempts: normalizedAttempts,
      attemptsTruncated: value.attemptsTruncated
    };
  }

  function normalizedFollowerLastHit(value) {
    if (value === null) return null;
    if (!value || typeof value !== "object") return false;
    const id = asOptionalNonNegativeInteger(value.id);
    const sourceNumber = asRouletteNumber(value.sourceNumber);
    const fixedNumbers = normalizedFollowerFixedNumbers(value.fixedNumbers);
    const attemptCount = asOptionalNonNegativeInteger(value.attemptCount);
    const missCount = asOptionalNonNegativeInteger(value.missCount);
    const hitNumber = asRouletteNumber(value.hitNumber);
    const hitRank = asOptionalNonNegativeInteger(value.hitRank);
    if (
      id === null || id < 1
      || sourceNumber === null
      || fixedNumbers === null
      || attemptCount === null || attemptCount < 1
      || missCount !== attemptCount - 1
      || hitNumber === null
      || hitRank === null || hitRank < 1 || hitRank > 5
      || fixedNumbers[hitRank - 1] !== hitNumber
      || !parseDate(value.completedAt)
    ) {
      return false;
    }
    return {
      id,
      sourceNumber,
      fixedNumbers,
      attemptCount,
      missCount,
      hitNumber,
      hitRank,
      completedAt: value.completedAt
    };
  }

  function normalizedFollowerTop5Tracker(value) {
    const statuses = new Set(["armed", "active", "gap", "waiting_training"]);
    if (
      !value || typeof value !== "object"
      || value.schemaVersion !== 1
      || value.algorithmVersion !== "follower-top5-live-v1"
      || value.mode !== "simulation"
      || value.executionEnabled !== false
      || value.trackingMode !== "persisted-batch-aware"
      || value.topCount !== 5
      || value.minimumObservedFollowerCount !== 5
      || !statuses.has(value.status)
    ) {
      return null;
    }

    const hasCurrentSession = value.status === "armed" || value.status === "active";
    if (
      (hasCurrentSession && (!value.currentSession || typeof value.currentSession !== "object"))
      || (!hasCurrentSession && value.currentSession !== null)
    ) {
      return null;
    }
    const currentSession = hasCurrentSession
      ? normalizedFollowerLiveSession(value.currentSession, value.status)
      : null;
    const lastCompletedSession = normalizedFollowerLastHit(value.lastCompletedSession);
    if ((hasCurrentSession && !currentSession) || lastCompletedSession === false) return null;

    return {
      status: value.status,
      currentSession,
      lastCompletedSession
    };
  }

  function renderFollowerLiveFixedNumbers(numbers) {
    const fragment = document.createDocumentFragment();
    if (!numbers) {
      for (let index = 0; index < 5; index += 1) {
        fragment.appendChild(createElement("li", "follower-live__placeholder", "—"));
      }
      elements.followerLiveFixedList.setAttribute("aria-label", "Зафиксированная пятёрка пока недоступна");
      elements.followerLiveFixedList.replaceChildren(fragment);
      return;
    }

    numbers.forEach((number, index) => {
      const item = createElement("li", "follower-live__fixed-item");
      const rank = createElement("span", "follower-live__rank", `№${index + 1}`);
      const ball = createElement("span", `history-number ${rouletteColorClass(number)}`, number);
      ball.setAttribute("aria-hidden", "true");
      item.setAttribute("aria-label", `Место ${index + 1}: число ${number}, ${rouletteColorLabel(number)}`);
      item.append(rank, ball);
      fragment.appendChild(item);
    });
    elements.followerLiveFixedList.setAttribute("aria-label", "Зафиксированные пять чисел по местам");
    elements.followerLiveFixedList.replaceChildren(fragment);
  }

  function renderFollowerLiveAttempts(session) {
    const fragment = document.createDocumentFragment();
    elements.followerLiveAttemptList.setAttribute("aria-busy", "false");
    if (!session || session.attemptCount === 0) {
      fragment.appendChild(createElement(
        "li",
        "follower-live__attempt-empty",
        session ? "Пока нет завершённых попыток." : "Нет активной серии."
      ));
      elements.followerLiveAttemptList.replaceChildren(fragment);
      return;
    }

    if (session.attemptsTruncated) {
      const hiddenCount = session.attemptCount - session.attempts.length;
      fragment.appendChild(createElement(
        "li",
        "follower-live__attempt-truncated",
        `Ранее ещё ${hiddenCount} ${pluralForm(hiddenCount, "промах", "промаха", "промахов")}`
      ));
    }

    session.attempts.forEach((attempt) => {
      const item = createElement("li", "follower-live__attempt-item");
      const label = createElement("span", "follower-live__attempt-number", `№${attempt.attemptNumber}`);
      const ball = createElement(
        "span",
        `follower-live__attempt-ball ${rouletteColorClass(attempt.resultNumber)}`,
        attempt.resultNumber
      );
      ball.setAttribute("aria-hidden", "true");
      const outcome = createElement("span", "follower-live__attempt-outcome", "промах");
      const time = createElement("time", "follower-live__attempt-time", formatDateTime(attempt.settledAt));
      time.dateTime = parseDate(attempt.settledAt).toISOString();
      item.setAttribute(
        "aria-label",
        `Попытка ${attempt.attemptNumber}: выпало ${attempt.resultNumber}, ${rouletteColorLabel(attempt.resultNumber)}, промах, ${formatDateTime(attempt.settledAt, { alwaysShowDate: true })}`
      );
      item.append(label, ball, outcome, time);
      fragment.appendChild(item);
    });
    elements.followerLiveAttemptList.replaceChildren(fragment);
  }

  function renderFollowerLiveHistory(nextAttemptNumber) {
    if (nextAttemptNumber === null) {
      setTextIfChanged(elements.followerLiveHistoryRate, "—");
      setTextIfChanged(elements.followerLiveHistoryDetail, "Появится после фиксации пятёрки");
      return;
    }
    if (!store.pairsLoaded) {
      setTextIfChanged(elements.followerLiveHistoryRate, "—");
      setTextIfChanged(
        elements.followerLiveHistoryDetail,
        store.pairsError ? "Исторический расчёт недоступен" : "Загружаем общую историю…"
      );
      return;
    }

    const curve = normalizedFollowerAllPoints();
    if (!curve) {
      setTextIfChanged(elements.followerLiveHistoryRate, "—");
      setTextIfChanged(elements.followerLiveHistoryDetail, "Сервер не вернул полный ряд 1–20");
      return;
    }

    const referenceAttempt = Math.min(nextAttemptNumber, 20);
    const point = curve.points[referenceAttempt - 1];
    const staleSuffix = store.pairsError ? " · не обновлено" : "";
    if (point.eligibleCount === 0) {
      setTextIfChanged(elements.followerLiveHistoryRate, "—");
      setTextIfChanged(
        elements.followerLiveHistoryDetail,
        `К попытке ${referenceAttempt}: пока нет полных 20-раундовых окон${staleSuffix}`
      );
      return;
    }

    setTextIfChanged(
      elements.followerLiveHistoryRate,
      nextAttemptNumber > 20
        ? `${historicalPercentFormatter.format(point.rate)} · ≤20`
        : historicalPercentFormatter.format(point.rate)
    );
    setTextIfChanged(
      elements.followerLiveHistoryDetail,
      nextAttemptNumber > 20
        ? `К попытке 20: ${point.hitCount} из ${point.eligibleCount}; текущая №${nextAttemptNumber}, дальше без экстраполяции${staleSuffix}`
        : `К попытке ${nextAttemptNumber}: ${point.hitCount} из ${point.eligibleCount} в общей сохранённой истории${staleSuffix}`
    );
  }

  function renderFollowerLiveLastHit(lastHit) {
    elements.followerLiveLastHit.hidden = !lastHit;
    if (!lastHit) {
      setTextIfChanged(elements.followerLiveLastHit, "");
      return;
    }
    setTextIfChanged(
      elements.followerLiveLastHit,
      `Последнее попадание: число ${lastHit.hitNumber} (место №${lastHit.hitRank}) на попытке ${lastHit.attemptCount}. Серия закрыта ${formatDateTime(lastHit.completedAt, { alwaysShowDate: true })}, счёт сброшен.`
    );
  }

  function renderFollowerLiveUnavailable(state, status, message, busy = false) {
    elements.followerLive.dataset.state = state;
    elements.followerLive.setAttribute("aria-busy", String(busy));
    setTextIfChanged(elements.followerLiveStatus, status);
    setTextIfChanged(elements.followerLiveSource, "—");
    setTextIfChanged(elements.followerLiveCurrentAttempt, "—");
    setTextIfChanged(elements.followerLiveAttemptSummary, "Нет активной серии");
    setTextIfChanged(elements.followerLiveLockMeta, message);
    renderFollowerLiveFixedNumbers(null);
    renderFollowerLiveAttempts(null);
    renderFollowerLiveHistory(null);
    renderFollowerLiveLastHit(null);
  }

  function renderFollowerTop5Tracker(value) {
    if (!value) {
      if (!store.stateLoaded && !store.stateError) {
        renderFollowerLiveUnavailable("loading", "Загрузка…", "Получаем состояние live‑тестирования.", true);
      } else if (store.stateError) {
        renderFollowerLiveUnavailable("error", "Ошибка загрузки", "Не удалось получить состояние live‑тестирования. Повторим автоматически.");
      } else {
        renderFollowerLiveUnavailable("error", "Нет данных", "Сервер не передал состояние live‑тестирования.");
      }
      return;
    }

    const tracker = normalizedFollowerTop5Tracker(value);
    if (!tracker) {
      renderFollowerLiveUnavailable(
        "error",
        "Данные отклонены",
        "Сервер вернул неподтверждённый режим или повреждённое состояние. Live‑значения скрыты."
      );
      return;
    }

    const stale = store.stateError;
    const staleSuffix = stale ? " · не обновлено" : "";
    elements.followerLive.dataset.state = stale ? "stale" : tracker.status;
    elements.followerLive.setAttribute("aria-busy", "false");
    renderFollowerLiveLastHit(tracker.lastCompletedSession);

    if (!tracker.currentSession) {
      setTextIfChanged(elements.followerLiveSource, "—");
      setTextIfChanged(elements.followerLiveCurrentAttempt, "—");
      setTextIfChanged(elements.followerLiveAttemptSummary, "Нет активной серии");
      renderFollowerLiveFixedNumbers(null);
      renderFollowerLiveAttempts(null);
      renderFollowerLiveHistory(null);
      if (tracker.status === "gap") {
        setTextIfChanged(elements.followerLiveStatus, `Пауза после разрыва${staleSuffix}`);
        setTextIfChanged(
          elements.followerLiveLockMeta,
          "Разрыв непрерывности сбросил текущую серию. Новая пятёрка появится после подтверждённого раунда и достаточной истории."
        );
      } else {
        setTextIfChanged(elements.followerLiveStatus, `Ждём обучения${staleSuffix}`);
        setTextIfChanged(
          elements.followerLiveLockMeta,
          "Для новой фиксации нужны не менее 5 разных сохранённых продолжений исходного числа."
        );
      }
      return;
    }

    const session = tracker.currentSession;
    setTextIfChanged(elements.followerLiveStatus, tracker.status === "armed"
      ? `Пятёрка зафиксирована${staleSuffix}`
      : `Попытка №${session.nextAttemptNumber}${staleSuffix}`);
    setTextIfChanged(elements.followerLiveSource, session.sourceNumber);
    setTextIfChanged(elements.followerLiveCurrentAttempt, `№${session.nextAttemptNumber}`);
    setTextIfChanged(
      elements.followerLiveAttemptSummary,
      session.attemptCount === 0
        ? "Ждём первый следующий сохранённый результат"
        : `${session.missCount} ${pluralForm(session.missCount, "сохранённый промах", "сохранённых промаха", "сохранённых промахов")}; попадание закроет серию`
    );
    setTextIfChanged(
      elements.followerLiveLockMeta,
      `Зафиксировано ${formatDateTime(session.lockedAt, { alwaysShowDate: true })} · ${session.sampleSize} ${pluralForm(session.sampleSize, "переход", "перехода", "переходов")} в выборке, ${session.observedFollowerCount} разных продолжений.`
    );
    renderFollowerLiveFixedNumbers(session.fixedNumbers);
    renderFollowerLiveAttempts(session);
    renderFollowerLiveHistory(session.nextAttemptNumber);
  }

  function followerHitEmpty(message) {
    const group = createElement("div", "follower-horizon__empty");
    const term = createElement("dt", "sr-only", "Состояние расчёта");
    const description = createElement("dd", "", message);
    group.append(term, description);
    return group;
  }

  function renderFollowerHitCurve() {
    if (!store.pairsLoaded) {
      const failed = store.pairsError;
      elements.followerHorizon.dataset.state = failed ? "error" : "loading";
      elements.followerHorizon.setAttribute("aria-busy", String(!failed));
      elements.followerHorizonStatus.textContent = failed ? "Ошибка загрузки" : "Считаем…";
      elements.followerHorizonList.replaceChildren(followerHitEmpty(
        failed
          ? "Не удалось загрузить проверку Top‑5. Повторим автоматически."
          : "Загружаем накопительную статистику…"
      ));
      return;
    }

    const curve = normalizedFollowerHitCurve();
    if (!curve) {
      elements.followerHorizon.dataset.state = "error";
      elements.followerHorizon.setAttribute("aria-busy", "false");
      elements.followerHorizonStatus.textContent = "Нет расчёта";
      elements.followerHorizonList.replaceChildren(followerHitEmpty(
        "Сервер пока не вернул накопительную проверку Top‑5."
      ));
      return;
    }

    const fragment = document.createDocumentFragment();
    curve.points.forEach(({ horizon, hitCount, eligibleCount }) => {
      const point = createElement("div", "follower-horizon__point");
      const rounds = createElement(
        "dt",
        "follower-horizon__rounds",
        `≤ ${horizon} ${pluralForm(horizon, "раунд", "раунда", "раундов")}`
      );
      const rate = createElement(
        "dd",
        "follower-horizon__rate",
        eligibleCount > 0
          ? historicalPercentFormatter.format(hitCount / eligibleCount)
          : "—"
      );
      const count = createElement(
        "span",
        "follower-horizon__count",
        eligibleCount > 0 ? `${hitCount} из ${eligibleCount}` : "нет полной выборки"
      );
      const randomBaseline = 1 - ((37 - 5) / 37) ** horizon;
      const baseline = createElement(
        "span",
        "follower-horizon__baseline",
        `случайная база ${historicalPercentFormatter.format(randomBaseline)}`
      );
      rate.append(count, baseline);
      point.append(rounds, rate);
      point.setAttribute(
        "aria-label",
        eligibleCount > 0
          ? `Не позднее ${horizon} ${pluralForm(horizon, "раунда", "раундов", "раундов")}: ${hitCount} попаданий из ${eligibleCount}, ${historicalPercentFormatter.format(hitCount / eligibleCount)}; случайная база ${historicalPercentFormatter.format(randomBaseline)}`
          : `Не позднее ${horizon} ${pluralForm(horizon, "раунда", "раундов", "раундов")}: пока нет полной выборки; случайная база ${historicalPercentFormatter.format(randomBaseline)}`
      );
      fragment.appendChild(point);
    });

    elements.followerHorizon.dataset.state = store.pairsError ? "stale" : "ready";
    elements.followerHorizon.setAttribute("aria-busy", "false");
    elements.followerHorizonStatus.textContent = curve.eligibleCount > 0
      ? `${curve.eligibleCount} ${pluralForm(curve.eligibleCount, "проверка", "проверки", "проверок")} · все числа${store.pairsError ? " · не обновлено" : ""}`
      : "Ждём полную выборку";
    elements.followerHorizonList.replaceChildren(fragment);
  }

  function renderFollowers(latestResult) {
    renderFollowerHitCurve();
    const latestNumber = asRouletteNumber(latestResult?.number);
    if (!store.followerSourceLocked && latestNumber !== null) {
      if (store.followerSourceNumber !== latestNumber) {
        store.followerVisibleCount = FOLLOWER_COLLAPSED_LIMIT;
      }
      store.followerSourceNumber = latestNumber;
    }

    const sourceNumber = asRouletteNumber(store.followerSourceNumber);
    elements.followerSource.disabled = sourceNumber === null && latestNumber === null;
    if (sourceNumber === null) {
      elements.followerPanel.dataset.state = "empty";
      elements.followerTitle.textContent = "Что выпадало следующим";
      elements.followerCount.textContent = "0 переходов";
      elements.followerList.replaceChildren(createElement("li", "empty-state", "Ждём первое сохранённое выпадение."));
      elements.followerList.setAttribute("aria-busy", "false");
      elements.followerToggle.hidden = true;
      return;
    }

    elements.followerSource.value = String(sourceNumber);
    elements.followerTitle.textContent = `Что выпадало после ${sourceNumber}`;
    elements.followerDescription.textContent = `Следующие сохранённые результаты после числа ${sourceNumber} внутри непрерывных участков истории.`;

    if (!store.pairsLoaded) {
      elements.followerPanel.dataset.state = store.pairsError ? "error" : "loading";
      elements.followerCount.textContent = store.pairsError ? "— · ошибка" : "Считаем…";
      elements.followerCount.title = store.pairsError
        ? "Не удалось загрузить исторические переходы"
        : "";
      elements.followerList.replaceChildren(createElement(
        "li",
        "empty-state",
        store.pairsError
          ? "Не удалось загрузить исторические переходы. Повторим автоматически."
          : `Считаем, что выпадало после ${sourceNumber}…`
      ));
      elements.followerList.setAttribute("aria-busy", String(!store.pairsError));
      elements.followerToggle.hidden = true;
      return;
    }

    const stats = buildFollowerStats(store.pairs, sourceNumber);
    elements.followerPanel.dataset.state = store.pairsError ? "stale" : "ready";
    const sampleLabel = `${stats.sampleSize} ${pluralForm(stats.sampleSize, "переход", "перехода", "переходов")}`;
    elements.followerCount.textContent = store.pairsError
      ? `${sampleLabel} · не обновлено`
      : sampleLabel;
    elements.followerCount.title = store.pairsError
      ? "Показаны последние успешно загруженные данные"
      : `Выборка известных следующих результатов после ${sourceNumber}`;
    elements.followerList.setAttribute("aria-busy", "false");

    if (stats.sampleSize === 0) {
      elements.followerPanel.dataset.state = "empty";
      elements.followerList.replaceChildren(createElement(
        "li",
        "empty-state",
        `После ${sourceNumber} ещё нет сохранённого следующего результата.`
      ));
      elements.followerToggle.hidden = true;
      return;
    }

    const visibleCount = Math.max(
      FOLLOWER_COLLAPSED_LIMIT,
      Math.min(store.followerVisibleCount, stats.items.length)
    );
    const fragment = document.createDocumentFragment();

    stats.items.slice(0, visibleCount).forEach((item, index) => {
      const card = createElement("li", "follower-card");
      if (item.occurrenceCount === 0) card.classList.add("is-unseen");
      card.dataset.rank = String(index + 1);

      const sequence = createElement("div", "follower-card__sequence");
      sequence.setAttribute("aria-hidden", "true");
      const sourceBall = createElement(
        "span",
        `history-number follower-card__number ${rouletteColorClass(sourceNumber)}`,
        sourceNumber
      );
      const arrow = createElement("span", "follower-card__arrow", "→");
      const followerBall = createElement(
        "span",
        `history-number follower-card__number ${rouletteColorClass(item.number)}`,
        item.number
      );
      sequence.append(sourceBall, arrow, followerBall);

      const copy = createElement("div", "follower-card__copy");
      const share = createElement(
        "strong",
        "follower-card__share",
        item.occurrenceCount > 0 ? historicalPercentFormatter.format(item.share) : "0%"
      );
      const count = createElement(
        "span",
        "follower-card__count",
        item.occurrenceCount > 0
          ? `${item.occurrenceCount} из ${stats.sampleSize} переходов`
          : `0 из ${stats.sampleSize} · не встречалось`
      );
      const last = createElement(
        "time",
        "follower-card__last",
        item.lastOccurredAt
          ? `Последний раз: ${formatDateTime(item.lastOccurredAt, { alwaysShowDate: true })}`
          : "В истории ещё не встречалось"
      );
      if (item.lastOccurredAt) last.dateTime = item.lastOccurredAt;
      copy.append(share, count, last);
      card.setAttribute(
        "aria-label",
        item.occurrenceCount > 0
          ? `После числа ${sourceNumber} число ${item.number} встретилось ${item.occurrenceCount} ${pluralForm(item.occurrenceCount, "раз", "раза", "раз")} из ${stats.sampleSize}; историческая доля ${historicalPercentFormatter.format(item.share)}`
          : `После числа ${sourceNumber} число ${item.number} в сохранённой выборке ещё не встречалось, но остаётся возможным`
      );
      card.append(sequence, copy);
      fragment.appendChild(card);
    });

    elements.followerList.replaceChildren(fragment);
    const expanded = visibleCount >= stats.items.length;
    elements.followerToggle.hidden = stats.items.length <= FOLLOWER_COLLAPSED_LIMIT;
    elements.followerToggle.setAttribute("aria-expanded", String(expanded));
    elements.followerToggle.textContent = expanded
      ? `Показать топ-${FOLLOWER_COLLAPSED_LIMIT}`
      : `Показать все ${stats.items.length}`;
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
  elements.followerSource.addEventListener("change", () => {
    const sourceNumber = asRouletteNumber(elements.followerSource.value);
    if (sourceNumber === null) return;
    store.followerSourceNumber = sourceNumber;
    store.followerSourceLocked = true;
    store.followerVisibleCount = FOLLOWER_COLLAPSED_LIMIT;
    renderFollowers(store.state?.latestResult || store.results[0] || null);
  });
  elements.followerToggle.addEventListener("click", () => {
    store.followerVisibleCount = store.followerVisibleCount >= ALL_NUMBERS.length
      ? FOLLOWER_COLLAPSED_LIMIT
      : ALL_NUMBERS.length;
    renderFollowers(store.state?.latestResult || store.results[0] || null);
  });
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

  initializeFollowerSource();
  renderNumberGrid(null);
  renderRiskCalculator();
  connectEventStream();
  refreshAll();
  window.setInterval(() => refreshAll(), REFRESH_INTERVAL_MS);
  window.setInterval(() => {
    if (store.stateLoaded) renderPrecloseForecast();
  }, 1_000);
  window.setInterval(() => {
    updateLastSync();
    updateNumberAges();
    updateOverdueAges();
    updateTripleAges();
  }, AGE_UPDATE_INTERVAL_MS);
})();
