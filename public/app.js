const DEFAULT_TRIGGER_THRESHOLD = 200;
const REFRESH_INTERVAL_MS = 45_000;

function nonNegativeInteger(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
}

function rouletteNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 && number <= 36 ? number : null;
}

function roundWord(value) {
  const absolute = Math.abs(value);
  const lastTwo = absolute % 100;
  const last = absolute % 10;
  if (lastTwo >= 11 && lastTwo <= 14) return "сохранённых раундов";
  if (last === 1) return "сохранённый раунд";
  if (last >= 2 && last <= 4) return "сохранённых раунда";
  return "сохранённых раундов";
}

function waitingCopy(candidate) {
  const number = rouletteNumber(candidate?.number);
  const rounds = nonNegativeInteger(candidate?.roundsSinceLast);
  if (number === null || rounds === null) {
    return "Подтверждённой истории пока недостаточно.";
  }
  return `Самая длинная текущая серия у числа ${number}: ${rounds} ${roundWord(rounds)} без выпадения.`;
}

export function buildAutotestView(virtualBettor) {
  if (!virtualBettor || typeof virtualBettor !== "object") {
    return {
      state: "loading",
      title: "Получаем состояние…",
      copy: "Ожидаем данные."
    };
  }

  if (virtualBettor.mode !== "simulation" || virtualBettor.executionEnabled !== false) {
    return {
      state: "error",
      title: "Состояние автотеста недоступно",
      copy: "Сервер не подтвердил безопасный режим симуляции."
    };
  }

  const configuredThreshold = nonNegativeInteger(virtualBettor.triggerThreshold);
  const threshold = configuredThreshold && configuredThreshold > 0
    ? configuredThreshold
    : DEFAULT_TRIGGER_THRESHOLD;
  const status = String(virtualBettor.status || "").toLowerCase();
  const session = virtualBettor.activeSession && typeof virtualBettor.activeSession === "object"
    ? virtualBettor.activeSession
    : null;
  const targetNumber = rouletteNumber(session?.targetNumber);
  const triggerRounds = nonNegativeInteger(session?.triggerRoundsMissed);
  const bankExhausted = status === "bankroll_exhausted"
    || String(virtualBettor.testBank?.status || "").toLowerCase() === "exhausted";

  if (bankExhausted) {
    return {
      state: "error",
      title: "Автотест остановлен",
      copy: "Виртуальный лимит исчерпан."
    };
  }

  if (status === "waiting") {
    return {
      state: "waiting",
      title: `Ждём ${threshold} сохранённых раундов`,
      copy: waitingCopy(virtualBettor.longestCandidate)
    };
  }

  if (status === "armed") {
    return {
      state: "armed",
      title: targetNumber === null ? "Цель выбрана" : `Цель выбрана: число ${targetNumber}`,
      copy: triggerRounds === null
        ? "Ждём следующий сохранённый раунд."
        : `Серия достигла ${triggerRounds} ${roundWord(triggerRounds)}. Ждём следующий сохранённый раунд.`
    };
  }

  if (status === "active") {
    const misses = nonNegativeInteger(session?.missCount);
    return {
      state: "active",
      title: targetNumber === null ? "Автотест идёт" : `Автотест идёт: число ${targetNumber}`,
      copy: misses === null
        ? "Ждём совпадение с выбранным числом."
        : `После выбора цели: ${misses} ${roundWord(misses)} без совпадения.`
    };
  }

  if (status.includes("gap") || status.includes("invalid")) {
    return {
      state: "error",
      title: "История прервалась",
      copy: "Ждём новый непрерывный участок сохранённых раундов."
    };
  }

  return {
    state: "error",
    title: "Состояние автотеста неизвестно",
    copy: "Ожидаем обновление данных."
  };
}

function initializeAutotestPage() {
  const card = document.getElementById("autotest-card");
  const title = document.getElementById("autotest-status-title");
  const copy = document.getElementById("autotest-status-copy");
  if (!card || !title || !copy) return;

  let eventSource = null;
  let refreshTimer = null;
  let refreshing = false;
  let refreshQueued = false;
  let hasRenderedData = false;
  let lastGoodView = null;

  const render = (view, { remember = true } = {}) => {
    if (remember) lastGoodView = view;
    card.dataset.state = view.state;
    card.setAttribute("aria-busy", "false");
    title.textContent = view.title;
    copy.textContent = view.copy;
  };

  const refresh = async () => {
    if (refreshing) {
      refreshQueued = true;
      return;
    }
    refreshing = true;
    refreshQueued = false;
    card.setAttribute("aria-busy", "true");
    const controller = new AbortController();
    const requestTimeout = window.setTimeout(() => controller.abort(), 12_000);

    try {
      const response = await fetch("/api/state", {
        cache: "no-store",
        headers: { Accept: "application/json" },
        signal: controller.signal
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const state = await response.json();
      if (!state?.virtualBettor || typeof state.virtualBettor !== "object") {
        throw new Error("virtualBettor is missing");
      }
      render(buildAutotestView(state?.virtualBettor));
      hasRenderedData = true;
    } catch {
      if (!hasRenderedData) {
        render({
          state: "error",
          title: "Не удалось получить состояние",
          copy: "Повторяем запрос автоматически."
        }, { remember: false });
      } else if (lastGoodView) {
        render({
          ...lastGoodView,
          state: "stale",
          copy: `Не удалось обновить данные. ${lastGoodView.copy}`
        }, { remember: false });
      }
    } finally {
      window.clearTimeout(requestTimeout);
      refreshing = false;
      if (refreshQueued) scheduleRefresh();
    }
  };

  const scheduleRefresh = () => {
    window.clearTimeout(refreshTimer);
    refreshTimer = window.setTimeout(refresh, 180);
  };

  if ("EventSource" in window) {
    eventSource = new EventSource("/api/events");
    eventSource.addEventListener("update", scheduleRefresh);
    eventSource.addEventListener("message", scheduleRefresh);
  }

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") refresh();
  });
  window.addEventListener("beforeunload", () => eventSource?.close());
  window.setInterval(refresh, REFRESH_INTERVAL_MS);
  refresh();
}

if (typeof document !== "undefined") initializeAutotestPage();
