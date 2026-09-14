import test from "node:test";
import assert from "node:assert/strict";
import {
  CALIBRATION_BURST_FREQ_HZ,
  CALIBRATION_BURST_DURATION_SEC,
  CALIBRATION_CORRELATION_THRESHOLD,
  generateReferenceBurst,
  computeNormalizedCorrelation,
  createCalibrationProcessorClass
} from "../../core/calibration-signal.js";
import {
  runAcousticCalibrationCollector,
  DEFAULT_WORKLET_MODULE_URL
} from "../../core/calibration-collector.js";

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

  // Device not found
  const mockMediaDevicesNoDevice = {
    getUserMedia: async () => {
      const err = new Error("Device not found");
      err.name = "NotFoundError";
      throw err;
    }
  };
  const res3 = await runAcousticCalibrationCollector({
    audioContext: mockAudioContext,
    mediaDevices: mockMediaDevicesNoDevice
  });
  assert.equal(res3.unmeasurable, true);
  assert.equal(res3.reason, "利用できるマイクが見つかりませんでした。");

  // Other media failure (e.g. NotReadableError)
  const mockMediaDevicesOtherErr = {
    getUserMedia: async () => {
      const err = new Error("Device busy");
      err.name = "NotReadableError";
      throw err;
    }
  };
  const res4 = await runAcousticCalibrationCollector({
    audioContext: mockAudioContext,
    mediaDevices: mockMediaDevicesOtherErr
  });
  assert.equal(res4.unmeasurable, true);
  assert.equal(res4.reason, "マイクを開始できませんでした。");
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

  let currentTime = 1.0;
  let destinationConnected = null;
  const mockAudioContext = {
    sampleRate: 48000,
    get currentTime() { return currentTime; },
    destination: { name: "default-dest" },
    audioWorklet: { addModule: async () => {} },
    createMediaStreamSource: () => ({ connect: () => {}, disconnect: () => {} }),
    createGain: () => ({
      gain: { value: 1 },
      connect: () => {},
      disconnect: () => {}
    }),
    createBuffer: () => ({ copyToChannel: () => {} }),
    createBufferSource: () => ({
      connect: (target) => { destinationConnected = target; },
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

  const customOutput = { name: "custom-master" };
  const res = await runAcousticCalibrationCollector({
    audioContext: mockAudioContext,
    mediaDevices: mockMediaDevices,
    outputDestination: customOutput,
    AudioWorkletNodeClass: MockWorkletNode,
    sampleCount: 2,
    timeoutMs: 1000
  });

  assert.equal(res.unmeasurable, undefined);
  assert.equal(destinationConnected, customOutput);
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

  let currentTime = 1.0;
  let burstCount = 0;
  const mockAudioContext = {
    sampleRate: 48000,
    get currentTime() { return currentTime; },
    destination: {},
    audioWorklet: { addModule: async () => {} },
    createMediaStreamSource: () => ({ connect: () => {}, disconnect: () => {} }),
    createGain: () => ({
      gain: { value: 1 },
      connect: () => {},
      disconnect: () => {}
    }),
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
    AudioWorkletNodeClass: MockWorkletNode,
    sampleCount: 2,
    timeoutMs: 500
  });

  // Since trial 1 missed its window, it must immediately abort as unmeasurable
  assert.equal(res.unmeasurable, true);
  assert.ok(res.reason.includes("第1試行"));
  // And burstCount must only be 1 (did NOT proceed to trial 2)
  assert.equal(burstCount, 1);
});

test("runAcousticCalibrationCollector resolves worklet URL against module and passes to addModule", async () => {
  assert.ok(DEFAULT_WORKLET_MODULE_URL.endsWith("/calibration-processor.js") || DEFAULT_WORKLET_MODULE_URL.includes("calibration-processor.js"));

  let addedModuleUrl = null;
  const mockTrack = {
    getSettings: () => ({
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      deviceId: "mic-1"
    }),
    stop: () => {}
  };
  const mockAudioContext = {
    sampleRate: 48000,
    currentTime: 0,
    audioWorklet: {
      addModule: async (url) => {
        addedModuleUrl = url;
      }
    }
  };
  const mockMediaDevices = {
    getUserMedia: async () => ({
      getAudioTracks: () => [mockTrack],
      getTracks: () => [mockTrack]
    })
  };

  // Run with default URL, which fails gracefully at AudioWorkletNodeClass check
  await runAcousticCalibrationCollector({
    audioContext: mockAudioContext,
    mediaDevices: mockMediaDevices,
    AudioWorkletNodeClass: null
  });

  assert.equal(addedModuleUrl, DEFAULT_WORKLET_MODULE_URL);

  // Run with custom URL
  await runAcousticCalibrationCollector({
    audioContext: mockAudioContext,
    mediaDevices: mockMediaDevices,
    workletModuleUrl: "./custom-processor.js",
    AudioWorkletNodeClass: null
  });

  assert.equal(addedModuleUrl, "./custom-processor.js");
});

test("runAcousticCalibrationCollector maps unexpected errors to Japanese explanation without exposing English exception text", async () => {
  const mockTrack = {
    getSettings: () => ({
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      deviceId: "mic-1"
    }),
    stop: () => {}
  };
  const mockAudioContext = {
    audioWorklet: {
      addModule: async () => {
        throw new DOMException("Failed to load module script: NetworkError", "NetworkError");
      }
    }
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
  assert.equal(res.reason, "校正処理中にエラーが発生しました。マイクとスピーカーの接続を確認して再試行してください。");
  assert.equal(res.reason.includes("NetworkError"), false);
});

test("runAcousticCalibrationCollector rejects detections that precede reference burst (observedTime < t_ref)", async () => {
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

  let currentTime = 1.0;
  const mockAudioContext = {
    sampleRate: 48000,
    get currentTime() { return currentTime; },
    destination: {},
    audioWorklet: { addModule: async () => {} },
    createMediaStreamSource: () => ({ connect: () => {}, disconnect: () => {} }),
    createGain: () => ({
      gain: { value: 1 },
      connect: () => {},
      disconnect: () => {}
    }),
    createBuffer: () => ({ copyToChannel: () => {} }),
    createBufferSource: () => ({
      connect: () => {},
      start: (t_ref) => {
        // Emit a pre-burst onset at t_ref - 0.005 s
        if (messageHandler) {
          messageHandler({
            data: {
              type: "onset",
              observedTime: t_ref - 0.005,
              observedFrame: Math.round((t_ref - 0.005) * 48000),
              score: 0.99
            }
          });
        }
        // Then emit a valid onset at t_ref + 0.035 s
        setTimeout(() => {
          currentTime = t_ref + 0.035;
          if (messageHandler) {
            messageHandler({
              data: {
                type: "onset",
                observedTime: t_ref + 0.035,
                observedFrame: Math.round((t_ref + 0.035) * 48000),
                score: 0.95
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
    AudioWorkletNodeClass: MockWorkletNode,
    sampleCount: 1,
    timeoutMs: 1000
  });

  assert.equal(res.unmeasurable, undefined);
  assert.equal(res.samples.length, 1);
  // Must match the valid onset after t_ref, NOT the pre-burst onset
  assert.ok(Math.abs((res.samples[0].observedTime - res.samples[0].referenceTime) - 0.035) < 1e-4);
  assert.ok(res.samples[0].observedTime >= res.samples[0].referenceTime);
});

test("createCalibrationProcessorClass defines testable processor without globals", () => {
  class MockBaseProcessor {
    constructor() {
      this.port = {
        postMessage: (msg) => { this.lastMessage = msg; },
        onmessage: null
      };
    }
  }

  let mockScope = {
    sampleRate: 48000,
    currentFrame: 0,
    currentTime: 1.0
  };

  const ProcessorClass = createCalibrationProcessorClass(MockBaseProcessor, () => mockScope);
  const processor = new ProcessorClass();

  assert.equal(processor.sampleRate, 48000);
  assert.equal(typeof processor.process, "function");

  // Generate burst and pass as input block
  const burst = generateReferenceBurst(48000);
  const padding = new Float32Array(50);
  const inputBuffer = new Float32Array(padding.length + burst.length + 1000);
  inputBuffer.set(burst, padding.length);

  // Process in 128-sample blocks
  let onsets = [];
  processor.port.postMessage = (msg) => {
    if (msg?.type === "onset") onsets.push(msg);
  };

  for (let offset = 0; offset < inputBuffer.length; offset += 128) {
    const block = inputBuffer.subarray(offset, Math.min(offset + 128, inputBuffer.length));
    mockScope.currentFrame = offset;
    mockScope.currentTime = 1.0 + offset / 48000;
    processor.process([[block]], [], {});
  }

  assert.equal(onsets.length, 1);
  assert.ok(onsets[0].score >= CALIBRATION_CORRELATION_THRESHOLD);
  assert.equal(onsets[0].observedFrame, padding.length);
});

test("createCalibrationProcessorClass requires explicit dependencies and clock provider", () => {
  class MockBaseProcessor {}

  assert.throws(() => {
    createCalibrationProcessorClass(null, () => ({}));
  }, TypeError);

  assert.throws(() => {
    createCalibrationProcessorClass(MockBaseProcessor);
  }, TypeError);

  assert.throws(() => {
    createCalibrationProcessorClass(MockBaseProcessor, "not-a-fn");
  }, TypeError);

  const IncompleteScopeClass = createCalibrationProcessorClass(MockBaseProcessor, () => ({
    sampleRate: 48000
  }));

  assert.throws(() => {
    new IncompleteScopeClass();
  }, TypeError);
});
