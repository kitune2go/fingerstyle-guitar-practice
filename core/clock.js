export function createScheduler({
  context,
  lookahead = 0.15,
  tickMs = 25,
  setTimer = setInterval,
  clearTimer = clearInterval,
} = {}) {
  if (!context || typeof context.currentTime !== "number") {
    throw new TypeError("context.currentTime が必要です。");
  }
  if (!Number.isFinite(lookahead) || lookahead <= 0) {
    throw new RangeError("lookahead は0より大きい有限数にしてください。");
  }
  if (!Number.isFinite(tickMs) || tickMs <= 0) {
    throw new RangeError("tickMs は0より大きい有限数にしてください。");
  }
  if (typeof setTimer !== "function" || typeof clearTimer !== "function") {
    throw new TypeError("タイマー関数が必要です。");
  }

  let timer = null;
  let active = false;
  let nextTime = null;
  let onSlot = null;

  function stop() {
    active = false;
    if (timer !== null) clearTimer(timer);
    timer = null;
    nextTime = null;
    onSlot = null;
  }

  function fillQueue() {
    if (!active) return;
    const now = Number(context.currentTime);
    if (!Number.isFinite(now)) {
      stop();
      throw new RangeError("context.currentTime は有限数にしてください。");
    }
    const horizon = now + lookahead;
    while (active && nextTime < horizon) {
      const step = onSlot(nextTime);
      if (step === null) {
        stop();
        return;
      }
      if (!Number.isFinite(step) || step <= 0) {
        stop();
        throw new RangeError("onSlot は0より大きい有限のstep、またはnullを返してください。");
      }
      nextTime += step;
    }
  }

  function start(firstTime, callback) {
    if (active) throw new Error("スケジューラは既に実行中です。");
    if (!Number.isFinite(firstTime)) {
      throw new RangeError("firstTime は有限数にしてください。");
    }
    if (typeof callback !== "function") {
      throw new TypeError("onSlot は関数にしてください。");
    }

    nextTime = firstTime;
    onSlot = callback;
    active = true;
    try {
      fillQueue();
      if (active) timer = setTimer(fillQueue, tickMs);
    } catch (error) {
      stop();
      throw error;
    }
  }

  return {
    start,
    stop,
    get running() {
      return active;
    },
  };
}
