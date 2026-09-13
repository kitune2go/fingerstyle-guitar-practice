import test from "node:test";
import assert from "node:assert/strict";
import {
  CALIBRATION_BURST_FREQ_HZ,
  CALIBRATION_BURST_DURATION_SEC,
  CALIBRATION_CORRELATION_THRESHOLD,
  generateReferenceBurst,
  computeNormalizedCorrelation
} from "../../core/calibration-signal.js";
import { runAcousticCalibrationCollector } from "../../core/calibration-collector.js";

test("calibration burst generation respects duration and non-zero energy", () => {
  const sampleRate = 48000;
  const burst = generateReferenceBurst(sampleRate);
  assert.equal(burst.length, Math.round(sampleRate * CALIBRATION_BURST_DURATION_SEC));
  assert.equal(burst.length, 480);
  assert.equal(burst[0], 0); // Hann window start
  assert.ok(Math.abs(burst[burst.length - 1]) < 1e-4); // Hann window end
  const maxVal = Math.max(...burst);
  assert.ok(maxVal > 0.5);
});

test("computeNormalizedCorrelation detects perfect match and rejects noise/silence", () => {
  const sampleRate = 48000;
  const burst = generateReferenceBurst(sampleRate);
  // Perfect match at offset 0
  const matchScore = computeNormalizedCorrelation(burst, 0, burst);
  assert.ok(Math.abs(matchScore - 1.0) < 1e-4);

  // Silence gives 0
  const silence = new Float32Array(burst.length * 2);
  const silenceScore = computeNormalizedCorrelation(silence, 0, burst);
  assert.equal(silenceScore, 0);

  // Inverted waveform gives -1
  const inverted = new Float32Array(burst.length);
  for (let i = 0; i < burst.length; i++) inverted[i] = -burst[i];
  const invertedScore = computeNormalizedCorrelation(inverted, 0, burst);
  assert.ok(Math.abs(invertedScore - (-1.0)) < 1e-4);
});

test("runAcousticCalibrationCollector returns unmeasurable on missing context or permissions", async () => {
  // No audio context
  const res1 = await runAcousticCalibrationCollector({ audioContext: null });
  assert.equal(res1.unmeasurable, true);
  assert.ok(res1.reason.includes("Web Audio"));

  // Permission denied
  const mockAudioContext = {
    audioWorklet: { addModule: async () => {} }
  };
  const mockMediaDevices = {
    getUserMedia: async () => {
      const err = new Error("Permission denied");
      err.name = "NotAllowedError";
      throw err;
    }
  };
  const res2 = await runAcousticCalibrationCollector({
    audioContext: mockAudioContext,
    mediaDevices: mockMediaDevices
  });
  assert.equal(res2.unmeasurable, true);
  assert.equal(res2.reason, "マイクの利用が許可されませんでした。");
});

test("runAcousticCalibrationCollector returns unmeasurable when raw capture cannot be verified", async () => {
  const mockTrack = {
    getSettings: () => ({
      echoCancellation: true, // echo cancellation active!
      noiseSuppression: false,
      autoGainControl: false,
      deviceId: "mic-1"
    }),
    stop: () => {}
  };
  const mockAudioContext = {
    audioWorklet: { addModule: async () => {} }
  };
  const mockMediaDevices = {
    getUserMedia: async () => ({
      getAudioTracks: () => [mockTrack],
      getTracks: () => [mockTrack]
    })
  };
  const res = await runAcousticCalibrationCollector({
    audioContext: mockAudioContext,
    mediaDevices: mockMediaDevices
  });
  assert.equal(res.unmeasurable, true);
  assert.ok(res.reason.includes("マイクの音声処理"));
});

test("runAcousticCalibrationCollector produces samples with unit 's' when onsets detected", async () => {
  const mockTrack = {
    getSettings: () => ({
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      deviceId: "mic-1"
    }),
    stop: () => {}
  };
  let messageHandler = null;
  class MockWorkletNode {
    constructor() {
      this.port = {
        set onmessage(fn) { messageHandler = fn; },
        get onmessage() { return messageHandler; }
      };
    }
    connect() {}
    disconnect() {}
  }
  globalThis.AudioWorkletNode = MockWorkletNode;

  let currentTime = 1.0;
  const mockAudioContext = {
    sampleRate: 48000,
    get currentTime() { return currentTime; },
    destination: {},
    audioWorklet: { addModule: async () => {} },
    createMediaStreamSource: () => ({ connect: () => {}, disconnect: () => {} }),
    createBuffer: () => ({ copyToChannel: () => {} }),
    createBufferSource: () => ({
      connect: () => {},
      start: (t_ref) => {
        // simulate AudioWorklet onset detection arriving 40 ms later
        setTimeout(() => {
          currentTime = t_ref + 0.04;
          if (messageHandler) {
            messageHandler({
              data: {
                type: "onset",
                observedTime: t_ref + 0.04,
                observedFrame: Math.round((t_ref + 0.04) * 48000),
                score: 0.98
              }
            });
          }
        }, 10);
      }
    })
  };
  const mockMediaDevices = {
    getUserMedia: async () => ({
      getAudioTracks: () => [mockTrack],
      getTracks: () => [mockTrack]
    })
  };

  const res = await runAcousticCalibrationCollector({
    audioContext: mockAudioContext,
    mediaDevices: mockMediaDevices,
    sampleCount: 2,
    timeoutMs: 1000
  });

  assert.equal(res.unmeasurable, undefined);
  assert.equal(res.samples.length, 2);
  assert.equal(res.samples[0].unit, "s");
  assert.ok(Math.abs((res.samples[0].observedTime - res.samples[0].referenceTime) - 0.04) < 1e-4);
});

test("runAcousticCalibrationCollector aborts as unmeasurable on missed burst and rejects late onsets", async () => {
  const mockTrack = {
    getSettings: () => ({
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      deviceId: "mic-1"
    }),
    stop: () => {}
  };
  let messageHandler = null;
  class MockWorkletNode {
    constructor() {
      this.port = {
        set onmessage(fn) { messageHandler = fn; },
        get onmessage() { return messageHandler; }
      };
    }
    connect() {}
    disconnect() {}
  }
  globalThis.AudioWorkletNode = MockWorkletNode;

  let currentTime = 1.0;
  let burstCount = 0;
  const mockAudioContext = {
    sampleRate: 48000,
    get currentTime() { return currentTime; },
    destination: {},
    audioWorklet: { addModule: async () => {} },
    createMediaStreamSource: () => ({ connect: () => {}, disconnect: () => {} }),
    createBuffer: () => ({ copyToChannel: () => {} }),
    createBufferSource: () => ({
      connect: () => {},
      start: (t_ref) => {
        burstCount++;
        if (burstCount === 1) {
          // Trial 1: Delay onset until AFTER the listening window expires (window is ~0.6s)
          setTimeout(() => {
            currentTime = t_ref + 0.8;
            if (messageHandler) {
              messageHandler({
                data: {
                  type: "onset",
                  observedTime: t_ref + 0.8,
                  observedFrame: Math.round((t_ref + 0.8) * 48000),
                  score: 0.95
                }
              });
            }
          }, 150); // Fires well after the 50ms wait in test
        }
      }
    })
  };
  const mockMediaDevices = {
    getUserMedia: async () => ({
      getAudioTracks: () => [mockTrack],
      getTracks: () => [mockTrack]
    })
  };

  const res = await runAcousticCalibrationCollector({
    audioContext: mockAudioContext,
    mediaDevices: mockMediaDevices,
    sampleCount: 2,
    timeoutMs: 500
  });

  // Since trial 1 missed its window, it must immediately abort as unmeasurable
  assert.equal(res.unmeasurable, true);
  assert.ok(res.reason.includes("第1試行"));
  // And burstCount must only be 1 (did NOT proceed to trial 2)
  assert.equal(burstCount, 1);
});
