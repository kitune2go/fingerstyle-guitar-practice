import assert from "node:assert/strict";
import test from "node:test";
import { createScheduler } from "../../core/clock.js";

function fakeTimers() {
  let callback = null;
  let cleared = 0;
  return {
    setTimer(fn, ms) {
      callback = fn;
      assert.equal(ms, 25);
      return 7;
    },
    clearTimer(id) {
      assert.equal(id, 7);
      cleared += 1;
      callback = null;
    },
    tick() {
      assert.ok(callback);
      callback();
    },
    get cleared() {
      return cleared;
    },
  };
}

test("imports in Node without browser globals", () => {
  assert.equal(typeof window, "undefined");
  assert.equal(typeof document, "undefined");
  assert.equal(typeof AudioContext, "undefined");
  assert.equal(typeof createScheduler, "function");
});

test("start immediately fills the lookahead window", () => {
  const context = { currentTime: 1 };
  const timers = fakeTimers();
  const slots = [];
  const scheduler = createScheduler({ context, setTimer: timers.setTimer, clearTimer: timers.clearTimer });
  scheduler.start(1.05, (time) => {
    slots.push(time);
    return 0.05;
  });
  assert.deepEqual(slots, [1.05, 1.1]);
  assert.equal(scheduler.running, true);
});

test("advancing currentTime fills more slots", () => {
  const context = { currentTime: 0 };
  const timers = fakeTimers();
  const slots = [];
  const scheduler = createScheduler({ context, setTimer: timers.setTimer, clearTimer: timers.clearTimer });
  scheduler.start(0.1, (time) => {
    slots.push(time);
    return 0.1;
  });
  assert.deepEqual(slots, [0.1]);
  context.currentTime = 0.16;
  timers.tick();
  assert.deepEqual(slots, [0.1, 0.2, 0.30000000000000004]);
});

test("uses variable steps returned by onSlot", () => {
  const context = { currentTime: 0 };
  const timers = fakeTimers();
  const slots = [];
  const steps = [0.04, 0.07, null];
  const scheduler = createScheduler({ context, lookahead: 0.2, setTimer: timers.setTimer, clearTimer: timers.clearTimer });
  scheduler.start(0.02, (time) => {
    slots.push(time);
    return steps.shift();
  });
  assert.deepEqual(slots, [0.02, 0.06, 0.13]);
  assert.equal(scheduler.running, false);
});

test("null ends scheduling without creating a timer", () => {
  const context = { currentTime: 0 };
  let timerCreated = false;
  const scheduler = createScheduler({
    context,
    setTimer() {
      timerCreated = true;
      return 1;
    },
    clearTimer() {},
  });
  scheduler.start(0, () => null);
  assert.equal(scheduler.running, false);
  assert.equal(timerCreated, false);
});

test("stop clears the timer", () => {
  const context = { currentTime: 0 };
  const timers = fakeTimers();
  const scheduler = createScheduler({ context, setTimer: timers.setTimer, clearTimer: timers.clearTimer });
  scheduler.start(1, () => 1);
  scheduler.stop();
  assert.equal(scheduler.running, false);
  assert.equal(timers.cleared, 1);
});

test("stop is idempotent", () => {
  const context = { currentTime: 0 };
  const timers = fakeTimers();
  const scheduler = createScheduler({ context, setTimer: timers.setTimer, clearTimer: timers.clearTimer });
  scheduler.start(1, () => 1);
  scheduler.stop();
  scheduler.stop();
  assert.equal(timers.cleared, 1);
});

for (const step of [0, -0.1, Number.NaN, Number.POSITIVE_INFINITY]) {
  test(`rejects invalid step ${String(step)}`, () => {
    const context = { currentTime: 0 };
    const scheduler = createScheduler({ context, setTimer() { return 1; }, clearTimer() {} });
    assert.throws(() => scheduler.start(0, () => step), /0より大きい有限のstep/);
    assert.equal(scheduler.running, false);
  });
}

test("double start is rejected while running", () => {
  const context = { currentTime: 0 };
  const scheduler = createScheduler({ context, setTimer() { return 1; }, clearTimer() {} });
  scheduler.start(1, () => 1);
  assert.throws(() => scheduler.start(2, () => 1), /既に実行中/);
  scheduler.stop();
});
