import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createAudioEngine } from "../../rhythm/core/audio-engine.js";
import {
  createScheduler,
  LOOKAHEAD_MS,
  SCHEDULE_AHEAD_SEC,
  START_DELAY_SEC
} from "../../rhythm/core/scheduler.js";
import {
  clampVisualOffset,
  createVisualClock,
  formatLatencyReadout,
  formatVisualOffset
} from "../../rhythm/core/visual-clock.js";
import { createGhostMode, GHOST_BLOCK_BARS } from "../../rhythm/modes/ghost-mode.js";
import { patterns } from "../../rhythm/pattern-model.js";

const PART_DEFS = [
  { key: "voice", label: "Voice", sample: "tom", sampleGain: 0.12, sampleDuration: 0.16, samplePan: -0.1, freq: 920, gain: 0.095, duration: 0.030 },
  { key: "right", label: "R.Hand", sample: "closedHat", accentSample: "openHat", sampleGain: 0.09, sampleDuration: 0.07, accentSampleDuration: 0.2, samplePan: -0.26, freq: 690, gain: 0.085, duration: 0.026 },
  { key: "left", label: "L.Hand", sample: "snare", sampleGain: 0.12, sampleDuration: 0.14, samplePan: 0.18, freq: 460, gain: 0.085, duration: 0.032 },
  { key: "foot", label: "Foot", sample: "kick", sampleGain: 0.17, sampleDuration: 0.20, samplePan: 0, freq: 150, gain: 0.15, duration: 0.060 }
];

function approximately(actual, expected, epsilon = 1e-12) {
  assert.ok(
    Math.abs(actual - expected) <= epsilon,
    `${actual} should be within ${epsilon} of ${expected}`
  );
}

function fakeAudioParam(initialValue = 0) {
  return {
    value: initialValue,
    calls: [],
    cancelScheduledValues(time) {
      this.calls.push(["cancelScheduledValues", time]);
    },
    setTargetAtTime(value, time, constant) {
      this.calls.push(["setTargetAtTime", value, time, constant]);
    },
    setValueAtTime(value, time) {
      this.calls.push(["setValueAtTime", value, time]);
    },
    exponentialRampToValueAtTime(value, time) {
      this.calls.push(["exponentialRampToValueAtTime", value, time]);
    }
  };
}

function fakeAudioContext() {
  const context = {
    state: "suspended",
    currentTime: 12,
    destination: { kind: "destination" },
    gains: [],
    oscillators: [],
    resumeCalls: 0,
    async resume() {
      this.resumeCalls += 1;
      this.state = "running";
    },
    createGain() {
      const node = {
        gain: fakeAudioParam(),
        connections: [],
        connect(target) {
          this.connections.push(target);
        }
      };
      this.gains.push(node);
      return node;
    },
    createOscillator() {
      const node = {
        type: "sine",
        frequency: fakeAudioParam(),
        connections: [],
        starts: [],
        stops: [],
        connect(target) {
          this.connections.push(target);
        },
        start(time) {
          this.starts.push(time);
        },
        stop(time) {
          this.stops.push(time);
        }
      };
      this.oscillators.push(node);
      return node;
    }
  };
  return context;
}

test("rhythm page is a thin document shell with external style and module entry", async () => {
  const [html, app, styles] = await Promise.all([
    readFile(new URL("../../rhythm.html", import.meta.url), "utf8"),
    readFile(new URL("../../rhythm.js", import.meta.url), "utf8"),
    readFile(new URL("../../rhythm.css", import.meta.url), "utf8")
  ]);

  assert.match(html, /<link rel="stylesheet" href="\.\/rhythm\.css" \/>/);
  assert.match(html, /<script type="module" src="\.\/rhythm\.js"><\/script>/);
  assert.equal(html.includes("<style>"), false);
  assert.equal(html.includes("function scheduleStep"), false);
  assert.ok(html.split("\n").length < 150);
  assert.ok(app.split("\n").length < 600);
  assert.ok(styles.includes(".orbit-marker.note-ghost"));
});

test("app composes explicit modules without duplicating their responsibilities", async () => {
  const [app, scheduler, visualClock, audioEngine, ghostMode, grid, orbit] =
    await Promise.all([
      readFile(new URL("../../rhythm.js", import.meta.url), "utf8"),
      readFile(new URL("../../rhythm/core/scheduler.js", import.meta.url), "utf8"),
      readFile(new URL("../../rhythm/core/visual-clock.js", import.meta.url), "utf8"),
      readFile(new URL("../../rhythm/core/audio-engine.js", import.meta.url), "utf8"),
      readFile(new URL("../../rhythm/modes/ghost-mode.js", import.meta.url), "utf8"),
      readFile(new URL("../../rhythm/views/grid-view.js", import.meta.url), "utf8"),
      readFile(new URL("../../rhythm/views/orbit-view.js", import.meta.url), "utf8")
    ]);

  for (const path of [
    "./core/sample-player.js",
    "./rhythm/core/audio-engine.js",
    "./rhythm/core/scheduler.js",
    "./rhythm/core/visual-clock.js",
    "./rhythm/modes/ghost-mode.js",
    "./rhythm/views/grid-view.js",
    "./rhythm/views/orbit-view.js"
  ]) {
    assert.ok(app.includes(path), path);
  }

  assert.equal(app.includes("function makeClick("), false);
  assert.equal(app.includes("function buildOrbit("), false);
  assert.equal(app.includes("function advanceGhost("), false);
  assert.ok(scheduler.includes("getSecondsPerStep"));
  assert.ok(visualClock.includes("getOutputTimestamp"));
  assert.ok(audioEngine.includes("createOscillator"));
  assert.ok(ghostMode.includes("handleScheduledStep"));
  assert.ok(grid.includes("createGridView"));
  assert.ok(orbit.includes("createOrbitView"));

  for (const source of [scheduler, visualClock, audioEngine, ghostMode]) {
    assert.equal(source.includes("document."), false);
    assert.equal(source.includes("querySelector"), false);
    assert.equal(source.includes("window."), false);
  }
  for (const source of [grid, orbit]) {
    assert.equal(source.includes("AudioContext"), false);
    assert.equal(source.includes("setInterval("), false);
    assert.equal(source.includes("requestAnimationFrame("), false);
  }
});

test("every relative ES Module import resolves to a repository file", async () => {
  const moduleUrls = [
    new URL("../../rhythm.js", import.meta.url),
    new URL("../../rhythm/pattern-model.js", import.meta.url),
    new URL("../../rhythm/core/audio-engine.js", import.meta.url),
    new URL("../../rhythm/core/scheduler.js", import.meta.url),
    new URL("../../rhythm/core/visual-clock.js", import.meta.url),
    new URL("../../rhythm/modes/ghost-mode.js", import.meta.url),
    new URL("../../rhythm/views/grid-view.js", import.meta.url),
    new URL("../../rhythm/views/orbit-view.js", import.meta.url),
    new URL("../../core/sample-player.js", import.meta.url)
  ];

  for (const moduleUrl of moduleUrls) {
    const source = await readFile(moduleUrl, "utf8");
    const imports = source.matchAll(/from\s+["'](\.[^"']+)["']/g);
    for (const match of imports) {
      const importedUrl = new URL(match[1], moduleUrl);
      const importedSource = await readFile(importedUrl, "utf8");
      assert.ok(importedSource.length > 0, `${moduleUrl.pathname} -> ${match[1]}`);
    }
  }
});

test("scheduler preserves 20 ms lookahead cadence and pattern-derived timing", () => {
  assert.equal(LOOKAHEAD_MS, 20);
  assert.equal(SCHEDULE_AHEAD_SEC, 0.20);
  assert.equal(START_DELAY_SEC, 0.08);

  let currentTime = 10;
  let intervalCallback = null;
  let intervalDelay = null;
  let clearedInterval = null;
  const scheduled = [];

  const scheduler = createScheduler({
    getCurrentTime: () => currentTime,
    getPattern: () => patterns.basic,
    getBpm: () => 60,
    onScheduleStep: (step, time) => scheduled.push({ step, time }),
    setIntervalFn(callback, delay) {
      intervalCallback = callback;
      intervalDelay = delay;
      return 91;
    },
    clearIntervalFn(id) {
      clearedInterval = id;
    }
  });

  assert.equal(scheduler.start(10.08), true);
  assert.equal(scheduler.start(10.08), false);
  assert.equal(intervalDelay, 20);
  assert.deepEqual(scheduled.map(event => event.step), [0, 1]);
  approximately(scheduled[0].time, 10.08);
  approximately(scheduled[1].time, 10.08 + 1 / 12);

  currentTime = 10.2;
  intervalCallback();
  assert.deepEqual(scheduled.map(event => event.step), [0, 1, 2, 3]);

  scheduler.stop();
  assert.equal(clearedInterval, 91);
  const countAfterStop = scheduled.length;
  intervalCallback();
  assert.equal(scheduled.length, countAfterStop);
  assert.equal(scheduler.getSnapshot().running, false);
});

test("scheduler preserves four complete legacy loops without cumulative drift", () => {
  const scheduled = [];
  const scheduler = createScheduler({
    getCurrentTime: () => 0,
    getPattern: () => patterns.basic,
    getBpm: () => 60,
    onScheduleStep: (step, time) => scheduled.push({ step, time }),
    scheduleAheadSec: 16,
    setIntervalFn: () => 1,
    clearIntervalFn: () => {}
  });

  scheduler.start(0);
  scheduler.stop();

  assert.equal(scheduled.length, 48 * 4);
  for (let index = 0; index < scheduled.length; index++) {
    assert.equal(scheduled[index].step, index % 48);
    approximately(scheduled[index].time, index / 12, 1e-10);
  }
});

test("visual clock prefers measured latency, keeps fallback exclusive, and applies offset", () => {
  const measuredContext = {
    currentTime: 5,
    baseLatency: 0.1,
    outputLatency: 0.2,
    getOutputTimestamp() {
      return { contextTime: 4.95, performanceTime: 1000 };
    }
  };
  const measuredClock = createVisualClock({
    performanceNow: () => 1000,
    smoothing: 1
  });
  measuredClock.setAudioContext(measuredContext);

  const measured = measuredClock.getOutputLatencyEstimate();
  approximately(measured.seconds, 0.05);
  assert.equal(measured.source, "getOutputTimestamp");
  approximately(measuredClock.now(), 4.95);

  assert.equal(measuredClock.setOffsetMs(149), 150);
  approximately(measuredClock.now(), 4.8);
  assert.equal(measuredClock.setOffsetMs(-149), -150);
  approximately(measuredClock.now(), 5.1);

  const fallbackClock = createVisualClock({ smoothing: 1 });
  fallbackClock.setAudioContext({
    currentTime: 5,
    baseLatency: 0.01,
    outputLatency: 0.02
  });
  assert.deepEqual(fallbackClock.getOutputLatencyEstimate(), {
    seconds: 0.03,
    source: "baseLatency + outputLatency"
  });
  approximately(fallbackClock.now(), 4.97);

  const zeroBoundaryClock = createVisualClock();
  zeroBoundaryClock.setAudioContext({
    currentTime: 1,
    baseLatency: 0.01,
    outputLatency: 0
  });
  assert.deepEqual(zeroBoundaryClock.getOutputLatencyEstimate(), {
    seconds: 0.01,
    source: "baseLatency"
  });

  assert.equal(clampVisualOffset(153), 150);
  assert.equal(clampVisualOffset(-153), -150);
  assert.equal(formatVisualOffset(15), "+15 ms");
  assert.equal(formatLatencyReadout(null), "出力遅延: 未計測");
});

test("audio engine keeps part buses and skips node creation for silent events", async () => {
  const context = fakeAudioContext();
  let factoryCalls = 0;
  const engine = createAudioEngine({
    partDefs: PART_DEFS,
    contextFactory() {
      factoryCalls += 1;
      return context;
    }
  });

  assert.equal(engine.makeClick(12.1, PART_DEFS[0], { step: 0 }), false);
  await engine.start(new Set(["voice"]));
  assert.equal(factoryCalls, 1);
  assert.equal(context.resumeCalls, 1);
  assert.equal(context.gains.length, 4);
  assert.deepEqual(context.gains.map(node => node.gain.value), [1, 0, 0, 0]);

  const gainCountBeforeSilentEvent = context.gains.length;
  assert.equal(
    engine.makeClick(12.2, PART_DEFS[0], { step: 0, velocity: 0 }),
    false
  );
  assert.equal(context.oscillators.length, 0);
  assert.equal(context.gains.length, gainCountBeforeSilentEvent);

  assert.equal(
    engine.makeClick(12.3, PART_DEFS[0], { step: 0, accent: true }),
    true
  );
  assert.equal(context.oscillators.length, 1);
  assert.equal(context.gains.length, 5);
  assert.deepEqual(context.oscillators[0].starts, [12.3]);
  approximately(context.oscillators[0].stops[0], 12.342);

  const envelopeCalls = context.gains[4].gain.calls;
  assert.deepEqual(envelopeCalls[0], ["setValueAtTime", 0.0001, 12.3]);
  assert.equal(envelopeCalls[1][0], "exponentialRampToValueAtTime");
  approximately(envelopeCalls[1][1], 0.095 * 1.35);

  engine.setActiveParts(new Set(["voice", "right"]));
  assert.deepEqual(context.gains[0].gain.calls.at(-1), [
    "setTargetAtTime",
    1,
    12,
    0.006
  ]);
  assert.deepEqual(context.gains[1].gain.calls.at(-1), [
    "setTargetAtTime",
    1,
    12,
    0.006
  ]);

  await engine.start(new Set(["voice", "right"]));
  assert.equal(factoryCalls, 1);
  assert.equal(context.resumeCalls, 1);
});

test("audio engine schedules expressive samples for every rhythm part and falls back per hit", async () => {
  const context = fakeAudioContext();
  const loaded = [];
  const scheduled = [];
  let sampleAvailable = true;
  const engine = createAudioEngine({
    partDefs: PART_DEFS,
    contextFactory: () => context,
    samplePlayerFactory(receivedContext) {
      assert.equal(receivedContext, context);
      return {
        async load(names) {
          loaded.push(...names);
          return { requested: names, loaded: names, failed: [] };
        },
        schedule(name, options) {
          scheduled.push({ name, ...options });
          return sampleAvailable ? { source: {} } : null;
        }
      };
    }
  });

  assert.throws(
    () => createAudioEngine({ partDefs: PART_DEFS }),
    /contextFactory is required/
  );

  await engine.start(new Set(PART_DEFS.map(part => part.key)));
  const loadResult = await engine.loadSamples(PART_DEFS.map(part => part.sample));
  assert.deepEqual(loaded, ["tom", "closedHat", "snare", "kick"]);
  assert.deepEqual(loadResult.failed, []);

  for (const part of PART_DEFS) {
    assert.equal(
      engine.makeClick(12.25, part, { step: 0, velocity: 0.5, accent: true }),
      true
    );
  }
  assert.deepEqual(scheduled.map(hit => hit.name), ["tom", "openHat", "snare", "kick"]);
  PART_DEFS.forEach((part, index) => {
    approximately(scheduled[index].gain, part.sampleGain * 0.5 * 1.35);
    assert.equal(
      scheduled[index].duration,
      part.accentSampleDuration ?? part.sampleDuration
    );
    assert.equal(scheduled[index].pan, part.samplePan);
    assert.equal(scheduled[index].destination, context.gains[index]);
  });
  assert.equal(context.oscillators.length, 0);

  sampleAvailable = false;
  assert.equal(engine.makeClick(12.5, PART_DEFS[0], { step: 0 }), true);
  assert.equal(context.oscillators.length, 1);

  engine.setSoundMode("synth");
  assert.equal(engine.makeClick(12.75, PART_DEFS[1], { step: 0 }), true);
  assert.equal(context.oscillators.length, 2);
});

test("ghost mode changes audio state every four real bars and delays UI state to visual time", () => {
  assert.equal(GHOST_BLOCK_BARS, 4);
  const ghost = createGhostMode();
  const activeParts = new Set(["voice", "right", "left", "foot"]);

  assert.equal(ghost.toggle(), true);
  for (let bar = 0; bar < 4; bar++) {
    ghost.handleScheduledStep(patterns.basic, 0, bar, activeParts);
  }
  assert.equal(ghost.isPartMuted("right"), false);

  ghost.handleScheduledStep(patterns.basic, 0, 4, activeParts);
  assert.equal(ghost.isPartMuted("right"), true);
  assert.equal(ghost.getVisibleMutedParts().has("right"), false);
  assert.equal(ghost.flushVisibleQueue(3.999), false);
  assert.equal(ghost.flushVisibleQueue(4), true);
  assert.equal(ghost.getVisibleMutedParts().has("right"), true);

  for (let bar = 0; bar < 5; bar++) {
    ghost.handleRenderedStep(patterns.basic, 0);
  }
  assert.equal(ghost.getBarsRemaining(), 4);

  for (let bar = 5; bar < 9; bar++) {
    ghost.handleScheduledStep(patterns.basic, 0, bar, activeParts);
  }
  assert.equal(ghost.isPartMuted("right"), true);
  assert.equal(ghost.isPartMuted("left"), true);

  ghost.reset();
  assert.equal(ghost.isEnabled(), true);
  assert.equal(ghost.isPartMuted("right"), false);
  assert.equal(ghost.getSnapshot().scheduledBarCount, 0);
});
