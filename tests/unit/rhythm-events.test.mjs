import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  patterns,
  DEFAULT_EVENT_VELOCITY,
  ACCENT_GAIN_MULTIPLIER,
  normalizeEvent,
  getEventStep,
  getEventVelocity,
  isEventAccented,
  isEventGhostNote,
  getEventGainMultiplier,
  getEffectiveEventGain,
  getEventAtStep,
  getEventsForBar,
  getTotalSteps,
  getSecondsPerStep,
  validatePattern
} from "../../rhythm/pattern-model.js";

const PART_GAINS = {
  voice: 0.095,
  right: 0.085,
  left: 0.085,
  foot: 0.15
};

const RICH_PATTERN_STEPS = {
  funk16: [0, 3, 6, 9, 12, 15, 18, 21, 24, 27, 30, 33, 36, 39, 42, 45],
  jazzRide: [0, 12, 20, 24, 36, 44],
  shuffle: [0, 8, 12, 20, 24, 32, 36, 44]
};

function fixture(events) {
  return {
    id: "rhythm-event-fixture",
    name: "Rhythm Event Fixture",
    family: "Test",
    description: "Synthetic rhythm event fixture",
    defaultBpm: 100,
    meter: { numerator: 4, denominator: 4 },
    pulse: { count: 4, unit: "quarter" },
    subdivisionsPerPulse: 12,
    bars: 1,
    events
  };
}

test("all shipped patterns use object rhythm events", () => {
  assert.equal(Object.keys(patterns).length, 12);

  for (const [patternId, pattern] of Object.entries(patterns)) {
    for (const [partKey, events] of Object.entries(pattern.events)) {
      assert.ok(Array.isArray(events), `${patternId}/${partKey}`);
      for (const event of events) {
        assert.equal(typeof event, "object", `${patternId}/${partKey}`);
        assert.equal(Array.isArray(event), false, `${patternId}/${partKey}`);
        assert.ok(Number.isInteger(event.step), `${patternId}/${partKey}/${JSON.stringify(event)}`);
      }
    }
  }
});

test("normalizeEvent provides one compatibility boundary for number and object events", () => {
  assert.deepEqual(normalizeEvent(12), {
    step: 12,
    velocity: 1,
    accent: false,
    ghostNote: false
  });
  assert.deepEqual(normalizeEvent({ step: 12 }), {
    step: 12,
    velocity: 1,
    accent: false,
    ghostNote: false
  });
  assert.deepEqual(normalizeEvent({
    step: 12,
    velocity: 0,
    accent: true,
    ghostNote: true
  }), {
    step: 12,
    velocity: 0,
    accent: true,
    ghostNote: true
  });
  assert.equal(normalizeEvent("12"), null);
});

test("number events work through validation, scheduler lookup, and Orbit bar extraction", () => {
  const pattern = fixture({
    voice: [0, 12, { step: 24, velocity: 0.6, ghostNote: true }]
  });

  assert.deepEqual(validatePattern(pattern), []);

  assert.deepEqual(getEventAtStep(pattern, "voice", 0), {
    step: 0,
    velocity: 1,
    accent: false,
    ghostNote: false
  });
  assert.deepEqual(getEventAtStep(pattern, "voice", 24), {
    step: 24,
    velocity: 0.6,
    accent: false,
    ghostNote: true
  });

  assert.deepEqual(getEventsForBar(pattern, "voice", 0), [
    { step: 0, velocity: 1, accent: false, ghostNote: false },
    { step: 12, velocity: 1, accent: false, ghostNote: false },
    { step: 24, velocity: 0.6, accent: false, ghostNote: true }
  ]);
});

test("mixed number/object duplicate steps are rejected", () => {
  const duplicate = fixture({
    voice: [12, { step: 12, accent: true }]
  });
  assert.ok(validatePattern(duplicate).some(error => error.includes("duplicate step 12")));
});

test("event defaults preserve timing and expression defaults", () => {
  const event = { step: 12 };

  assert.equal(getEventStep(event), 12);
  assert.equal(getEventVelocity(event), DEFAULT_EVENT_VELOCITY);
  assert.equal(DEFAULT_EVENT_VELOCITY, 1);
  assert.equal(isEventAccented(event), false);
  assert.equal(isEventGhostNote(event), false);
  assert.equal(getEventGainMultiplier(event), 1);
});

test("velocity, accent, and ghostNote are expression-only attributes", () => {
  const plain = { step: 18 };
  const silent = { step: 18, velocity: 0 };
  const quiet = { step: 18, velocity: 0.5 };
  const accented = { step: 18, accent: true };
  const ghost = { step: 18, velocity: 0.35, ghostNote: true };

  for (const event of [plain, silent, quiet, accented, ghost]) {
    assert.equal(getEventStep(event), 18);
  }

  assert.equal(getEventVelocity(silent), 0);
  assert.equal(getEventVelocity(quiet), 0.5);
  assert.equal(isEventAccented(accented), true);
  assert.equal(isEventGhostNote(ghost), true);
  assert.equal(getEventGainMultiplier(silent), 0);
  assert.equal(getEventGainMultiplier(quiet), 0.5);
  assert.equal(getEventGainMultiplier(accented), ACCENT_GAIN_MULTIPLIER);
  assert.equal(getEventGainMultiplier(ghost), 0.35);

  const secondsPerStep = getSecondsPerStep(patterns.rock8, patterns.rock8.defaultBpm);
  const scheduledTime = event => getEventStep(event) * secondsPerStep;
  assert.equal(scheduledTime(plain), scheduledTime(silent));
  assert.equal(scheduledTime(plain), scheduledTime(quiet));
  assert.equal(scheduledTime(plain), scheduledTime(accented));
  assert.equal(scheduledTime(plain), scheduledTime(ghost));
});

test("default event gain is exactly backward compatible for every part", () => {
  for (const [partKey, legacyGain] of Object.entries(PART_GAINS)) {
    assert.equal(getEffectiveEventGain(legacyGain, 0), legacyGain, partKey);
    assert.equal(getEffectiveEventGain(legacyGain, { step: 0 }), legacyGain, partKey);
  }
});

test("velocity zero is valid, silent, and accent remains bounded", () => {
  for (const [partKey, legacyGain] of Object.entries(PART_GAINS)) {
    const silent = getEffectiveEventGain(legacyGain, { step: 0, velocity: 0 });
    const quiet = getEffectiveEventGain(legacyGain, { step: 0, velocity: 0.5 });
    const normal = getEffectiveEventGain(legacyGain, { step: 0 });
    const accent = getEffectiveEventGain(legacyGain, { step: 0, accent: true });

    assert.equal(silent, 0, partKey);
    assert.equal(quiet, legacyGain * 0.5, partKey);
    assert.ok(accent > normal, partKey);
    assert.ok(Number.isFinite(accent), partKey);
    assert.ok(accent <= 1, partKey);
  }
});

test("explicit null expression values are rejected rather than defaulted", () => {
  const pattern = fixture({
    voice: [
      { step: 0, velocity: null },
      { step: 12, accent: null },
      { step: 24, ghostNote: null }
    ]
  });

  const errors = validatePattern(pattern);

  assert.ok(errors.some(error => error.includes("step 0 velocity must be finite")));
  assert.ok(errors.some(error => error.includes("step 12 accent must be boolean")));
  assert.ok(errors.some(error => error.includes("step 24 ghostNote must be boolean")));
});

test("validator accepts zero velocity and ghostNote, rejects invalid expression fields", () => {
  const valid = fixture({
    voice: [
      0,
      { step: 12, velocity: 0 },
      { step: 24, velocity: 1, accent: true, ghostNote: true },
      { step: 36, accent: false, ghostNote: false }
    ]
  });
  assert.deepEqual(validatePattern(valid), []);

  const invalid = fixture({
    voice: [
      "bad",
      { step: 1.5 },
      { step: -1 },
      { step: 48 },
      { step: 6, velocity: -0.01 },
      { step: 9, velocity: 1.01 },
      { step: 15, velocity: Number.NaN },
      { step: 21, accent: "yes" },
      { step: 27, ghostNote: "yes" }
    ]
  });
  const errors = validatePattern(invalid);

  assert.ok(errors.some(error => error.includes("unsupported event value")));
  assert.ok(errors.some(error => error.includes("non-integer step")));
  assert.ok(errors.some(error => error.includes("negative step")));
  assert.ok(errors.some(error => error.includes("outside totalSteps")));
  assert.ok(errors.some(error => error.includes("0 <= velocity <= 1")));
  assert.ok(errors.some(error => error.includes("velocity must be finite")));
  assert.ok(errors.some(error => error.includes("accent must be boolean")));
  assert.ok(errors.some(error => error.includes("ghostNote must be boolean")));
});

test("Funk, Jazz Ride, and Shuffle rich migration preserves exact steps and scheduler times", () => {
  const EPSILON = 1e-12;

  for (const [patternId, expectedSteps] of Object.entries(RICH_PATTERN_STEPS)) {
    const pattern = patterns[patternId];
    const actualEvents = pattern.events.right;
    const actualSteps = actualEvents.map(getEventStep);
    assert.deepEqual(actualSteps, expectedSteps, patternId);

    assert.ok(
      actualEvents.some(event =>
        getEventVelocity(event) !== 1 ||
        isEventAccented(event) ||
        isEventGhostNote(event)
      ),
      `${patternId} should contain rich expression data`
    );

    const secondsPerStep = getSecondsPerStep(pattern, pattern.defaultBpm);
    for (let loop = 0; loop < 4; loop++) {
      for (let i = 0; i < expectedSteps.length; i++) {
        const legacyTime = (loop * getTotalSteps(pattern) + expectedSteps[i]) * secondsPerStep;
        const richTime = (loop * getTotalSteps(pattern) + getEventStep(actualEvents[i])) * secondsPerStep;
        assert.ok(Math.abs(legacyTime - richTime) <= EPSILON, `${patternId}/${loop}/${i}`);
      }
    }
  }

  assert.ok(patterns.funk16.events.right.some(event => isEventGhostNote(event)));
  assert.ok(patterns.funk16.events.right.some(event => getEventVelocity(event) < 0.5));
  assert.ok(patterns.jazzRide.events.right.some(event => getEventVelocity(event) < 0.7));
  assert.ok(patterns.shuffle.events.right.some(event => getEventVelocity(event) < 0.8));
});

test("Grid and Orbit distinguish accent and ghost note without creating a second timing clock", async () => {
  const [styles, app, grid, orbit] = await Promise.all([
    readFile(new URL("../../rhythm.css", import.meta.url), "utf8"),
    readFile(new URL("../../rhythm.js", import.meta.url), "utf8"),
    readFile(new URL("../../rhythm/views/grid-view.js", import.meta.url), "utf8"),
    readFile(new URL("../../rhythm/views/orbit-view.js", import.meta.url), "utf8")
  ]);

  assert.equal(styles.includes(".cell.event.accent"), true);
  assert.equal(styles.includes(".cell.event.note-ghost"), true);
  assert.equal(styles.includes(".orbit-marker.accent"), true);
  assert.equal(styles.includes(".orbit-marker.note-ghost"), true);
  assert.equal(grid.includes("--event-opacity"), true);
  assert.equal(orbit.includes('"data-velocity": velocity'), true);

  assert.equal(grid.includes("isEventGhostNote(event)"), true);
  assert.equal(orbit.includes("isEventGhostNote(event)"), true);
  assert.equal(app.includes("getEventAtStep(pattern, part.key, step)"), true);
  assert.equal(app.includes("audioEngine.makeClick(time, part, event)"), true);

  assert.equal(app.includes("const visualNow = visualClock.now();"), true);
  assert.equal(app.includes("ghostMode.flushVisibleQueue(visualNow)"), true);
  assert.equal(app.includes("visualQueue[0].time <= visualNow"), true);
});

test("velocity zero is guarded before Web Audio exponential ramps", async () => {
  const audioEngine = await readFile(
    new URL("../../rhythm/core/audio-engine.js", import.meta.url),
    "utf8"
  );
  const makeClickStart = audioEngine.indexOf("function makeClick(time, part, event)");
  const returnStart = audioEngine.indexOf("return {", makeClickStart);
  assert.ok(makeClickStart >= 0 && returnStart > makeClickStart);
  const makeClick = audioEngine.slice(makeClickStart, returnStart);

  const guardIndex = makeClick.indexOf("if (peakGain <= 0) return false;");
  const oscillatorIndex = makeClick.indexOf("createOscillator()");
  const rampIndex = makeClick.indexOf("exponentialRampToValueAtTime(peakGain");
  assert.ok(guardIndex >= 0);
  assert.ok(oscillatorIndex > guardIndex);
  assert.ok(rampIndex > guardIndex);
});

test("number-event type branching exists only inside normalizeEvent", async () => {
  const model = await readFile(new URL("../../rhythm/pattern-model.js", import.meta.url), "utf8");
  const matches = model.match(/typeof event === "number"/g) || [];
  assert.equal(matches.length, 1);
  assert.equal(model.includes("export function normalizeEvent(event)"), true);
});

test("PR #2 and PR #3 invariants remain present", async () => {
  const [html, app, scheduler, visualClock, orbit] = await Promise.all([
    readFile(new URL("../../rhythm.html", import.meta.url), "utf8"),
    readFile(new URL("../../rhythm.js", import.meta.url), "utf8"),
    readFile(new URL("../../rhythm/core/scheduler.js", import.meta.url), "utf8"),
    readFile(new URL("../../rhythm/core/visual-clock.js", import.meta.url), "utf8"),
    readFile(new URL("../../rhythm/views/orbit-view.js", import.meta.url), "utf8")
  ]);

  for (const [source, required] of [
    [scheduler, "export const LOOKAHEAD_MS = 20;"],
    [scheduler, "export const SCHEDULE_AHEAD_SEC = 0.20;"],
    [visualClock, 'source: "getOutputTimestamp"'],
    [visualClock, 'source: "baseLatency + outputLatency"'],
    [html, 'min="-150" max="150"'],
    [app, "if (running || starting) return;"],
    [scheduler, "getTotalSteps(pattern)"],
    [app, "isBarBoundary(pattern, step)"],
    [orbit, "getEventsForBar(pattern, part.key, safeBarIndex)"]
  ]) {
    assert.equal(source.includes(required), true, required);
  }

  for (const obsolete of [
    "const lookaheadMs = 20;",
    "const scheduleAheadSec = 0.20;",
    'source: "getOutputTimestamp"',
    "getTotalSteps(currentPattern())"
  ]) {
    assert.equal(html.includes(obsolete), false, `inline engine code remains: ${obsolete}`);
  }

  const model = await readFile(new URL("../../rhythm/pattern-model.js", import.meta.url), "utf8");
  assert.equal(model.includes("numerator: 12"), true);
  assert.equal(model.includes("denominator: 8"), true);
  assert.equal(model.includes('unit: "dotted-quarter"'), true);
});
