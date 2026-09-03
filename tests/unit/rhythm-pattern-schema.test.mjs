import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  patterns,
  getStepsPerBar,
  getTotalSteps,
  getSecondsPerStep,
  getBarDuration,
  normalizeStep,
  getBarIndex,
  getStepWithinBar,
  getPulseIndex,
  isBarBoundary,
  getEventsForBar,
  validatePattern,
  validatePatternCollection
} from "../../rhythm/pattern-model.js";

const EXISTING_PATTERN_NAMES = [
  "Basic Independence",
  "Rock 8-Beat",
  "Funk 16th",
  "Shuffle / Blues",
  "Jazz Ride",
  "Reggae One-Drop",
  "House / Four-on-the-floor",
  "Disco 16th",
  "Tresillo 3-3-2",
  "Bossa-style",
  "12/8 Cross-Rhythm",
  "3:2 Polyrhythm"
];

const LEGACY = {
  basic: {
    bpm: 60,
    events: {
      voice: [0, 12, 24, 36],
      right: [0, 6, 12, 18, 24, 30, 36, 42],
      left: [0, 8, 16, 24, 32, 40],
      foot: [0, 24]
    }
  },
  rock8: {
    bpm: 92,
    events: {
      voice: [0, 12, 24, 36],
      right: [0, 6, 12, 18, 24, 30, 36, 42],
      left: [12, 36],
      foot: [0, 24]
    }
  },
  funk16: {
    bpm: 84,
    events: {
      voice: [0, 12, 24, 36],
      right: [0, 3, 6, 9, 12, 15, 18, 21, 24, 27, 30, 33, 36, 39, 42, 45],
      left: [12, 21, 36, 45],
      foot: [0, 9, 24, 30, 42]
    }
  },
  shuffle: {
    bpm: 90,
    events: {
      voice: [0, 12, 24, 36],
      right: [0, 8, 12, 20, 24, 32, 36, 44],
      left: [12, 36],
      foot: [0, 24]
    }
  },
  jazzRide: {
    bpm: 120,
    events: {
      voice: [0, 12, 24, 36],
      right: [0, 12, 20, 24, 36, 44],
      left: [12, 36],
      foot: [0, 12, 24, 36]
    }
  },
  reggae: {
    bpm: 76,
    events: {
      voice: [0, 12, 24, 36],
      right: [6, 18, 30, 42],
      left: [24],
      foot: [24]
    }
  },
  house: {
    bpm: 124,
    events: {
      voice: [0, 12, 24, 36],
      right: [6, 18, 30, 42],
      left: [12, 36],
      foot: [0, 12, 24, 36]
    }
  },
  disco: {
    bpm: 118,
    events: {
      voice: [6, 18, 30, 42],
      right: [0, 3, 6, 9, 12, 15, 18, 21, 24, 27, 30, 33, 36, 39, 42, 45],
      left: [12, 36],
      foot: [0, 12, 24, 36]
    }
  },
  tresillo: {
    bpm: 100,
    events: {
      voice: [0, 12, 24, 36],
      right: [0, 6, 12, 18, 24, 30, 36, 42],
      left: [0, 18, 36],
      foot: [0, 24]
    }
  },
  bossa: {
    bpm: 116,
    events: {
      voice: [0, 12, 24, 36],
      right: [0, 6, 12, 18, 24, 30, 36, 42],
      left: [0, 9, 18, 24, 33, 42],
      foot: [0, 24]
    }
  },
  afro12: {
    bpm: 96,
    events: {
      voice: [0, 12, 24, 36],
      right: [0, 4, 8, 12, 16, 20, 24, 28, 32, 36, 40, 44],
      left: [0, 16, 32],
      foot: [0, 12, 24, 36]
    }
  },
  poly32: {
    bpm: 72,
    events: {
      voice: [0, 24],
      right: [0, 16, 32],
      left: [0, 12, 24, 36],
      foot: [0, 24]
    }
  }
};

function fixture(overrides = {}) {
  return {
    id: "fixture",
    name: "Fixture",
    family: "Test",
    description: "Synthetic fixture",
    defaultBpm: 90,
    meter: { numerator: 4, denominator: 4 },
    pulse: { count: 4, unit: "quarter" },
    subdivisionsPerPulse: 12,
    bars: 1,
    events: { voice: [{ step: 0 }] },
    ...overrides
  };
}

test("all 12 migrated patterns satisfy the schema", () => {
  assert.equal(Object.keys(patterns).length, 12);
  assert.deepEqual(Object.values(patterns).map(pattern => pattern.name), EXISTING_PATTERN_NAMES);
  assert.deepEqual(validatePatternCollection(patterns), []);

  for (const pattern of Object.values(patterns)) {
    assert.ok(pattern.id);
    assert.ok(pattern.name);
    assert.ok(pattern.family);
    assert.ok(pattern.description);
    assert.ok(pattern.defaultBpm > 0);
    assert.ok(pattern.meter.numerator > 0);
    assert.ok(pattern.meter.denominator > 0);
    assert.ok(pattern.pulse.count > 0);
    assert.ok(pattern.pulse.unit);
    assert.ok(pattern.subdivisionsPerPulse > 0);
    assert.ok(pattern.bars >= 1);
  }
});

test("validator rejects malformed metadata and event positions", () => {
  const missing = fixture({ name: "" });
  assert.ok(validatePattern(missing).some(error => error.includes("name")));

  const invalidMeter = fixture({ meter: { numerator: 0, denominator: -8 } });
  const meterErrors = validatePattern(invalidMeter);
  assert.ok(meterErrors.some(error => error.includes("numerator")));
  assert.ok(meterErrors.some(error => error.includes("denominator")));

  const invalidPulse = fixture({
    pulse: { count: 0, unit: "" },
    subdivisionsPerPulse: 0,
    bars: 0
  });
  const pulseErrors = validatePattern(invalidPulse);
  assert.ok(pulseErrors.some(error => error.includes("pulse.count")));
  assert.ok(pulseErrors.some(error => error.includes("pulse.unit")));
  assert.ok(pulseErrors.some(error => error.includes("subdivisionsPerPulse")));
  assert.ok(pulseErrors.some(error => error.includes("bars")));

  const invalidEvents = fixture({
    events: {
      voice: [
        { step: 0 },
        { step: 0 },
        { step: -1 },
        { step: 1.5 },
        { step: 48 }
      ]
    }
  });
  const eventErrors = validatePattern(invalidEvents);
  assert.ok(eventErrors.some(error => error.includes("duplicate step 0")));
  assert.ok(eventErrors.some(error => error.includes("negative step -1")));
  assert.ok(eventErrors.some(error => error.includes("non-integer step 1.5")));
  assert.ok(eventErrors.some(error => error.includes("outside totalSteps")));
});

test("12/8 Cross-Rhythm is real 12/8 with dotted-quarter BPM pulses", () => {
  const pattern = patterns.afro12;
  assert.deepEqual(pattern.meter, {
    numerator: 12,
    denominator: 8,
    groups: [3, 3, 3, 3]
  });
  assert.deepEqual(pattern.pulse, {
    count: 4,
    unit: "dotted-quarter"
  });
  assert.equal(pattern.subdivisionsPerPulse, 12);
  assert.equal(getStepsPerBar(pattern), 48);
  assert.equal(getBarDuration(pattern, 96), 2.5);
});

test("schema can represent 3/4, 5/4, 6/8, 7/8, and 12/8", () => {
  const meters = [
    fixture({
      id: "three-four",
      meter: { numerator: 3, denominator: 4 },
      pulse: { count: 3, unit: "quarter" },
      events: { voice: [{ step: 0 }, { step: 12 }, { step: 24 }] }
    }),
    fixture({
      id: "five-four",
      meter: { numerator: 5, denominator: 4 },
      pulse: { count: 5, unit: "quarter" },
      events: { voice: [{ step: 0 }, { step: 12 }, { step: 24 }, { step: 36 }, { step: 48 }] }
    }),
    fixture({
      id: "six-eight",
      meter: { numerator: 6, denominator: 8, groups: [3, 3] },
      pulse: { count: 2, unit: "dotted-quarter" },
      events: { voice: [{ step: 0 }, { step: 12 }] }
    }),
    fixture({
      id: "seven-eight",
      meter: { numerator: 7, denominator: 8, groups: [2, 2, 3] },
      pulse: { count: 7, unit: "eighth" },
      subdivisionsPerPulse: 4,
      events: { voice: [{ step: 0 }, { step: 8 }, { step: 16 }] }
    }),
    fixture({
      id: "twelve-eight",
      meter: { numerator: 12, denominator: 8, groups: [3, 3, 3, 3] },
      pulse: { count: 4, unit: "dotted-quarter" },
      events: { voice: [{ step: 0 }, { step: 12 }, { step: 24 }, { step: 36 }] }
    })
  ];

  for (const pattern of meters) {
    assert.deepEqual(validatePattern(pattern), [], pattern.id);
  }
});

test("two-bar synthetic fixture derives boundaries, wrap, bar index, and Orbit extraction", () => {
  const pattern = fixture({
    id: "two-bar-seven-eight",
    meter: { numerator: 7, denominator: 8, groups: [2, 2, 3] },
    pulse: { count: 7, unit: "eighth" },
    subdivisionsPerPulse: 4,
    bars: 2,
    events: {
      voice: [{ step: 0 }, { step: 27 }, { step: 28 }, { step: 55 }],
      right: [{ step: 4 }, { step: 32 }]
    }
  });

  assert.deepEqual(validatePattern(pattern), []);
  assert.equal(getStepsPerBar(pattern), 28);
  assert.equal(getTotalSteps(pattern), 56);

  assert.equal(getBarIndex(pattern, 0), 0);
  assert.equal(getBarIndex(pattern, 27), 0);
  assert.equal(getBarIndex(pattern, 28), 1);
  assert.equal(getBarIndex(pattern, 55), 1);
  assert.equal(getStepWithinBar(pattern, 28), 0);
  assert.equal(getPulseIndex(pattern, 28), 0);

  assert.equal(isBarBoundary(pattern, 0), true);
  assert.equal(isBarBoundary(pattern, 28), true);
  assert.equal(isBarBoundary(pattern, 27), false);

  assert.equal(normalizeStep(pattern, 55 + 1), 0);
  assert.equal(normalizeStep(pattern, -1), 55);

  assert.deepEqual(getEventsForBar(pattern, "voice", 0).map(event => event.step), [0, 27]);
  assert.deepEqual(getEventsForBar(pattern, "voice", 1).map(event => event.step), [28, 55]);

  let barBoundariesAcrossTwoLoops = 0;
  for (let absoluteStep = 0; absoluteStep < getTotalSteps(pattern) * 2; absoluteStep++) {
    if (isBarBoundary(pattern, absoluteStep)) barBoundariesAcrossTwoLoops += 1;
  }
  assert.equal(barBoundariesAcrossTwoLoops, 4);
});

test("legacy 12-pattern scheduler event times are preserved for four loops", () => {
  const EPSILON = 1e-12;

  for (const [id, legacy] of Object.entries(LEGACY)) {
    const pattern = patterns[id];
    assert.ok(pattern, id);
    assert.equal(pattern.defaultBpm, legacy.bpm, id);
    assert.equal(getTotalSteps(pattern), 48, id);

    const oldSecondsPerStep = (60 / legacy.bpm) / 12;
    const newSecondsPerStep = getSecondsPerStep(pattern, pattern.defaultBpm);

    assert.ok(Math.abs(oldSecondsPerStep - newSecondsPerStep) <= EPSILON, id);

    for (const [partKey, legacyEvents] of Object.entries(legacy.events)) {
      assert.deepEqual(
        pattern.events[partKey].map(event => event.step),
        legacyEvents,
        `${id}/${partKey} event positions`
      );

      const oldTimes = [];
      const newTimes = [];
      for (let loop = 0; loop < 4; loop++) {
        for (const step of legacyEvents) {
          oldTimes.push((loop * 48 + step) * oldSecondsPerStep);
          newTimes.push((loop * getTotalSteps(pattern) + step) * newSecondsPerStep);
        }
      }

      assert.equal(oldTimes.length, newTimes.length);
      for (let i = 0; i < oldTimes.length; i++) {
        assert.ok(
          Math.abs(oldTimes[i] - newTimes[i]) <= EPSILON,
          `${id}/${partKey} timing mismatch at event ${i}: ${oldTimes[i]} vs ${newTimes[i]}`
        );
      }
    }
  }
});

test("main engine paths are pattern-derived and PR #2 timing safeguards remain", async () => {
  const [html, app, scheduler, visualClock, gridView, orbitView, audioEngine, ghostMode] =
    await Promise.all([
      readFile(new URL("../../rhythm.html", import.meta.url), "utf8"),
      readFile(new URL("../../rhythm.js", import.meta.url), "utf8"),
      readFile(new URL("../../rhythm/core/scheduler.js", import.meta.url), "utf8"),
      readFile(new URL("../../rhythm/core/visual-clock.js", import.meta.url), "utf8"),
      readFile(new URL("../../rhythm/views/grid-view.js", import.meta.url), "utf8"),
      readFile(new URL("../../rhythm/views/orbit-view.js", import.meta.url), "utf8"),
      readFile(new URL("../../rhythm/core/audio-engine.js", import.meta.url), "utf8"),
      readFile(new URL("../../rhythm/modes/ghost-mode.js", import.meta.url), "utf8")
    ]);
  const engineSources = [app, scheduler, gridView, orbitView, audioEngine, ghostMode].join("\n");

  for (const forbidden of [
    "STEPS_PER_BEAT",
    "STEPS_PER_BAR",
    "% 48",
    "repeat(48",
    "4/4 ・ 1小節ループ"
  ]) {
    assert.equal(engineSources.includes(forbidden), false, `fixed assumption remains: ${forbidden}`);
  }

  for (const required of [
    "getStepsPerBar(pattern)",
    "getTotalSteps(pattern)",
    "getEventsForBar(pattern, part.key, safeBarIndex)",
    "isBarBoundary(pattern, step)",
    "getBarIndex(pattern, step)",
    "getPulseIndex(pattern, step)",
    "getEventAtStep(pattern, part.key, step)",
    "getEffectiveEventGain(part.gain, event)"
  ]) {
    assert.equal(engineSources.includes(required), true, `missing pattern-derived path: ${required}`);
  }

  assert.equal(scheduler.includes("export const LOOKAHEAD_MS = 20;"), true);
  assert.equal(scheduler.includes("export const SCHEDULE_AHEAD_SEC = 0.20;"), true);
  assert.equal(html.includes('min="-150" max="150"'), true);
  assert.equal(visualClock.includes('typeof audioContext.getOutputTimestamp !== "function"'), true);
  assert.equal(visualClock.includes('source: "baseLatency + outputLatency"'), true);
  assert.equal(app.includes("if (running || starting) return;"), true);

  assert.equal(app.includes("const visualNow = visualClock.now();"), true);
  assert.equal(app.includes("ghostMode.flushVisibleQueue(visualNow)"), true);
  assert.equal(app.includes("visualQueue[0].time <= visualNow"), true);
});
