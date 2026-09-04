import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SAMPLE_ASSET_PATHS,
  createSamplePlayer,
} from "../../core/sample-player.js";

function fakeContext() {
  const created = { sources: [], gains: [] };
  const context = {
    currentTime: 4,
    destination: { name: "speakers" },
    async decodeAudioData(encoded) {
      return { duration: encoded.duration ?? 2 };
    },
    createBufferSource() {
      const source = {
        connections: [],
        playbackRate: { setValueAtTime(value, time) { source.rate = { value, time }; } },
        connect(node) { this.connections.push(node); },
        start(time) { this.started = time; },
        stop(time) { this.stopped = time; },
      };
      created.sources.push(source);
      return source;
    },
    createGain() {
      const automation = [];
      const gain = {
        automation,
        setValueAtTime(value, time) { automation.push(["set", value, time]); },
        linearRampToValueAtTime(value, time) { automation.push(["linear", value, time]); },
        exponentialRampToValueAtTime(value, time) { automation.push(["exponential", value, time]); },
      };
      const node = { gain, connections: [], connect(next) { this.connections.push(next); } };
      created.gains.push(node);
      return node;
    },
  };
  return { context, created };
}

const testInstruments = {
  guitar: [
    { path: "assets/audio/guitar-nylon/g3.mp3", midi: 55 },
    { path: "assets/audio/guitar-nylon/e4.mp3", midi: 64 },
  ],
  click: [{ path: "assets/audio/drums/hihat-closed.wav", midi: null }],
};

test("the shipped catalogue lists every local sample exactly once", () => {
  assert.equal(SAMPLE_ASSET_PATHS.length, 10);
  assert.equal(new Set(SAMPLE_ASSET_PATHS).size, SAMPLE_ASSET_PATHS.length);
  assert.ok(SAMPLE_ASSET_PATHS.every((path) => path.startsWith("assets/audio/")));
});

test("load decodes requested instruments and reports readiness", async () => {
  const { context } = fakeContext();
  const fetched = [];
  const player = createSamplePlayer({
    context,
    instruments: testInstruments,
    fetchArrayBuffer: async (url) => {
      fetched.push(url);
      return { duration: 1.5 };
    },
  });

  const result = await player.load(["click"]);
  assert.deepEqual(result.loaded, ["click"]);
  assert.deepEqual(result.failed, []);
  assert.equal(fetched.length, 1);
  assert.equal(player.isReady("click"), true);
  assert.equal(player.isReady("guitar"), false);
});

test("load accepts one instrument name without splitting it into characters", async () => {
  const { context } = fakeContext();
  const player = createSamplePlayer({
    context,
    instruments: testInstruments,
    fetchArrayBuffer: async () => ({ duration: 1 }),
  });

  const result = await player.load("click");
  assert.deepEqual(result.requested, ["click"]);
  assert.deepEqual(result.loaded, ["click"]);
});

test("schedule chooses the nearest pitch and uses the audio clock", async () => {
  const { context, created } = fakeContext();
  const player = createSamplePlayer({
    context,
    instruments: testInstruments,
    fetchArrayBuffer: async () => ({ duration: 3 }),
  });
  await player.load(["guitar"]);

  const event = player.schedule("guitar", {
    time: 7.25,
    midi: 62,
    gain: 0.4,
    duration: 0.5,
  });

  assert.ok(event);
  assert.equal(event.zone.midi, 64);
  assert.equal(event.rate, 2 ** (-2 / 12));
  assert.equal(created.sources[0].started, 7.25);
  assert.ok(created.sources[0].stopped > 7.25);
  assert.equal(created.gains[0].connections[0], context.destination);
});

test("a missing sample is silent until a later load retry succeeds", async () => {
  const { context } = fakeContext();
  let attempts = 0;
  const player = createSamplePlayer({
    context,
    instruments: testInstruments,
    fetchArrayBuffer: async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("offline");
      return { duration: 1 };
    },
  });

  const first = await player.load(["click"]);
  assert.deepEqual(first.failed, ["click"]);
  assert.equal(player.schedule("click"), null);

  const second = await player.load(["click"]);
  assert.deepEqual(second.loaded, ["click"]);
  assert.ok(player.schedule("click"));
  assert.equal(attempts, 2);
});
