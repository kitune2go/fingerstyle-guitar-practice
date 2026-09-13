import {
  CALIBRATION_BURST_FREQ_HZ,
  CALIBRATION_BURST_DURATION_SEC,
  generateReferenceBurst
} from "./calibration-signal.js";
import {
  resolveInputRoute,
  resolveOutputRoute,
  inspectTrackProcessing
} from "./audio-route.js";

export const DEFAULT_WORKLET_MODULE_URL = new URL("./calibration-processor.js", import.meta.url).href;

export async function runAcousticCalibrationCollector({
  audioContext,
  mediaDevices,
  outputDestination = audioContext?.destination,
  AudioWorkletNodeClass = (typeof AudioWorkletNode !== "undefined" ? AudioWorkletNode : null),
  workletModuleUrl = DEFAULT_WORKLET_MODULE_URL,
  sampleCount = 6,
  timeoutMs = 6000
} = {}) {
  if (!audioContext) {
    return { unmeasurable: true, reason: "Web Audioコンテキストが利用できません。" };
  }
  if (!mediaDevices?.getUserMedia) {
    return { unmeasurable: true, reason: "このブラウザではマイク録音APIを利用できません。" };
  }
  if (typeof audioContext.audioWorklet?.addModule !== "function") {
    return { unmeasurable: true, reason: "このブラウザはAudioWorkletに対応していません。" };
  }

  let stream = null;
  let workletNode = null;
  let sourceNode = null;
  let muteGain = null;

  try {
    // 1. Request microphone with all audio processing disabled
    try {
      stream = await mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false
        }
      });
    } catch (permErr) {
      return {
        unmeasurable: true,
        reason: "マイクの利用が許可されませんでした。"
      };
    }

    const track = stream.getAudioTracks()[0];
    if (!track) {
      return { unmeasurable: true, reason: "利用可能なマイクが見つかりませんでした。" };
    }

    const processing = inspectTrackProcessing(track);
    if (!processing.rawCaptureVerified) {
      return {
        unmeasurable: true,
        reason: "マイクの音声処理（エコーキャンセラー・ノイズ抑制等）を無効化できないため測定できません。"
      };
    }

    const routeInfo = {
      inputRoute: resolveInputRoute(track),
      outputRoute: resolveOutputRoute(audioContext),
      processing
    };

    // 2. Load the AudioWorklet processor module
    await audioContext.audioWorklet.addModule(workletModuleUrl);

    if (typeof AudioWorkletNodeClass !== "function") {
      return { unmeasurable: true, reason: "AudioWorkletNodeが利用できません。" };
    }

    sourceNode = audioContext.createMediaStreamSource(stream);
    workletNode = new AudioWorkletNodeClass(audioContext, "calibration-processor");
    sourceNode.connect(workletNode);

    // In Web Audio, nodes whose outputs do not connect to an active AudioDestinationNode
    // can be pruned or halted by browser rendering engines. Connect workletNode through
    // a zero-gain node to audioContext.destination to ensure active processing without audible output.
    if (typeof audioContext.createGain === "function") {
      muteGain = audioContext.createGain();
      muteGain.gain.value = 0;
      workletNode.connect(muteGain);
      muteGain.connect(audioContext.destination);
    }

    // 3. Prepare reference audio burst buffer
    const burstData = generateReferenceBurst(audioContext.sampleRate);
    const audioBuffer = audioContext.createBuffer(1, burstData.length, audioContext.sampleRate);
    audioBuffer.copyToChannel(burstData, 0);

    // 4. Setup onset receiver
    const collectedOnsets = [];
    workletNode.port.onmessage = (event) => {
      if (event.data?.type === "onset") {
        collectedOnsets.push(event.data);
      }
    };

    // 5. Emit bursts sequentially and observe detected onsets
    // Allocate generous listening window per burst derived from timeoutMs
    const samples = [];
    const burstListeningWindowSec = Math.max(0.6, Math.min(1.2, (timeoutMs / 1000) / sampleCount));
    let scheduledTime = audioContext.currentTime + 0.1; // start in 100 ms

    for (let s = 0; s < sampleCount; s++) {
      const t_ref = scheduledTime;
      const bufferSource = audioContext.createBufferSource();
      bufferSource.buffer = audioBuffer;
      bufferSource.connect(outputDestination || audioContext.destination);
      bufferSource.start(t_ref);

      // Wait until t_ref + burstListeningWindowSec has elapsed
      const waitMs = Math.max(50, Math.round((t_ref + burstListeningWindowSec - audioContext.currentTime) * 1000));
      await new Promise((resolve) => setTimeout(resolve, waitMs));

      // Match the earliest detected onset belonging to this burst: [t_ref - 0.02, t_ref + burstListeningWindowSec]
      const matchIndex = collectedOnsets.findIndex(
        (onset) => onset.observedTime >= t_ref - 0.02 && onset.observedTime <= t_ref + burstListeningWindowSec
      );

      if (matchIndex !== -1) {
        const matching = collectedOnsets[matchIndex];
        samples.push({
          referenceTime: t_ref,
          observedTime: matching.observedTime,
          unit: "s",
          score: matching.score
        });
        // Discard consumed and earlier onsets so they cannot match subsequent bursts
        collectedOnsets.splice(0, matchIndex + 1);
      } else {
        // A burst failed to receive an onset within its listening window.
        // Terminate immediately as unmeasurable to prevent delayed onsets from contaminating subsequent bursts.
        collectedOnsets.length = 0;
        return {
          unmeasurable: true,
          reason: `基準信号の検出がタイムアウトしました（第${s + 1}試行）。スピーカー音量を上げて静かな環境で再試行してください。`
        };
      }

      scheduledTime = Math.max(audioContext.currentTime + 0.08, t_ref + burstListeningWindowSec + 0.05);
    }

    if (samples.length === 0) {
      return {
        unmeasurable: true,
        reason: "測定に必要な基準信号が検出されませんでした。スピーカー音量を上げて静かな環境で再試行してください。"
      };
    }

    return {
      samples,
      route: routeInfo
    };
  } catch (err) {
    console.warn("[calibration-collector] unexpected error during calibration:", err);
    return {
      unmeasurable: true,
      reason: "校正処理中にエラーが発生しました。マイクとスピーカーの接続を確認して再試行してください。"
    };
  } finally {
    try { muteGain?.disconnect(); } catch {}
    try { sourceNode?.disconnect(); } catch {}
    try { workletNode?.disconnect(); } catch {}
    if (stream) {
      for (const tr of stream.getTracks()) {
        try { tr.stop(); } catch {}
      }
    }
  }
}
