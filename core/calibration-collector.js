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

export async function runAcousticCalibrationCollector({
  audioContext,
  mediaDevices,
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

    const routeInfo = {
      inputRoute: resolveInputRoute(track),
      outputRoute: resolveOutputRoute(audioContext),
      processing: inspectTrackProcessing(track)
    };

    // 2. Load the AudioWorklet processor module
    await audioContext.audioWorklet.addModule("./core/calibration-processor.js");

    sourceNode = audioContext.createMediaStreamSource(stream);
    workletNode = new AudioWorkletNode(audioContext, "calibration-processor");
    sourceNode.connect(workletNode);

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
    const samples = [];
    const intervalSec = 0.25; // 250 ms interval
    let scheduledTime = audioContext.currentTime + 0.1; // start in 100 ms

    for (let s = 0; s < sampleCount; s++) {
      const t_ref = scheduledTime;
      const bufferSource = audioContext.createBufferSource();
      bufferSource.buffer = audioBuffer;
      bufferSource.connect(audioContext.destination);
      bufferSource.start(t_ref);

      // Wait until t_ref + burst duration + 150 ms listening window
      const waitMs = Math.max(50, Math.round((t_ref + 0.15 - audioContext.currentTime) * 1000));
      await new Promise((resolve) => setTimeout(resolve, waitMs));

      // Check if an onset was received within [t_ref - 0.05, t_ref + 0.25]
      const matching = collectedOnsets.find(
        (onset) => onset.observedTime >= t_ref - 0.02 && onset.observedTime <= t_ref + 0.30
      );

      if (matching) {
        samples.push({
          referenceTime: t_ref,
          observedTime: matching.observedTime,
          score: matching.score
        });
      }

      scheduledTime = Math.max(audioContext.currentTime + 0.08, t_ref + intervalSec);
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
    return {
      unmeasurable: true,
      reason: err?.message || "校正処理中に予期しないエラーが発生しました。"
    };
  } finally {
    try { sourceNode?.disconnect(); } catch {}
    try { workletNode?.disconnect(); } catch {}
    if (stream) {
      for (const tr of stream.getTracks()) {
        try { tr.stop(); } catch {}
      }
    }
  }
}
