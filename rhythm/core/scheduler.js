import {
  getSecondsPerStep,
  getTotalSteps
} from "../pattern-model.js";

export const LOOKAHEAD_MS = 20;
export const SCHEDULE_AHEAD_SEC = 0.20;
export const START_DELAY_SEC = 0.08;

export function createScheduler({
  getCurrentTime,
  getPattern,
  getBpm,
  onScheduleStep,
  lookaheadMs = LOOKAHEAD_MS,
  scheduleAheadSec = SCHEDULE_AHEAD_SEC,
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval
}) {
  let running = false;
  let nextStep = 0;
  let nextNoteTime = 0;
  let intervalId = null;

  function tick() {
    if (!running) return;

    while (nextNoteTime < getCurrentTime() + scheduleAheadSec) {
      const pattern = getPattern();
      onScheduleStep(nextStep, nextNoteTime);
      nextNoteTime += getSecondsPerStep(pattern, getBpm());
      nextStep = (nextStep + 1) % getTotalSteps(pattern);
    }
  }

  function start(startTime) {
    if (running) return false;

    running = true;
    nextStep = 0;
    nextNoteTime = startTime;
    tick();
    intervalId = setIntervalFn(tick, lookaheadMs);
    return true;
  }

  function stop() {
    running = false;
    if (intervalId !== null) {
      clearIntervalFn(intervalId);
      intervalId = null;
    }
  }

  function getSnapshot() {
    return {
      running,
      nextStep,
      nextNoteTime,
      intervalId
    };
  }

  return {
    start,
    stop,
    tick,
    getSnapshot
  };
}
