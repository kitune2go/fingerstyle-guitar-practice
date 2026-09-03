export const MAX_PLAUSIBLE_LATENCY_SEC = 0.5;
export const LATENCY_SMOOTHING = 0.1;

export const LATENCY_SOURCE_LABELS = Object.freeze({
  getOutputTimestamp: "getOutputTimestamp",
  "baseLatency + outputLatency": "baseLatency + outputLatency",
  outputLatency: "outputLatency",
  baseLatency: "baseLatency",
  none: "取得不可（補正なし）"
});

export function clampVisualOffset(value) {
  const ms = Number(value);
  if (!Number.isFinite(ms)) return 0;
  return Math.min(150, Math.max(-150, Math.round(ms / 5) * 5));
}

export function formatVisualOffset(ms) {
  return (ms > 0 ? "+" : "") + ms + " ms";
}

export function formatLatencyReadout(snapshot) {
  if (!snapshot || snapshot.seconds === null) {
    return "出力遅延: 未計測";
  }

  return (
    "出力遅延: 約" + Math.round(snapshot.seconds * 1000) + " ms（" +
    (LATENCY_SOURCE_LABELS[snapshot.source] || snapshot.source) + "）"
  );
}

function browserPerformanceNow() {
  return performance.now();
}

export function createVisualClock({
  performanceNow = browserPerformanceNow,
  smoothing = LATENCY_SMOOTHING,
  maxLatencySec = MAX_PLAUSIBLE_LATENCY_SEC
} = {}) {
  let audioContext = null;
  let visualOffsetMs = 0;
  let smoothedLatencySec = null;
  let latencySource = "none";

  function setAudioContext(context) {
    audioContext = context;
  }

  function readTimestampLatency() {
    if (!audioContext || typeof audioContext.getOutputTimestamp !== "function") {
      return null;
    }

    let stamp;
    try {
      stamp = audioContext.getOutputTimestamp();
    } catch (error) {
      return null;
    }
    if (!stamp) return null;

    const { contextTime, performanceTime } = stamp;
    if (!Number.isFinite(contextTime) || !Number.isFinite(performanceTime)) return null;
    if (contextTime <= 0) return null;

    const sinceStampSec = (performanceNow() - performanceTime) / 1000;
    if (!Number.isFinite(sinceStampSec) || sinceStampSec < 0 || sinceStampSec > 1) {
      return null;
    }

    const latency = audioContext.currentTime - (contextTime + sinceStampSec);
    if (!Number.isFinite(latency) || latency < 0 || latency > maxLatencySec) {
      return null;
    }
    return latency;
  }

  function plausibleLatency(value) {
    return Number.isFinite(value) && value > 0 && value <= maxLatencySec;
  }

  function getOutputLatencyEstimate() {
    const measured = readTimestampLatency();
    if (measured !== null) {
      return { seconds: measured, source: "getOutputTimestamp" };
    }

    if (!audioContext) return { seconds: 0, source: "none" };

    const base = plausibleLatency(audioContext.baseLatency)
      ? audioContext.baseLatency
      : null;
    const output = plausibleLatency(audioContext.outputLatency)
      ? audioContext.outputLatency
      : null;

    if (base !== null && output !== null) {
      const combined = base + output;
      if (plausibleLatency(combined)) {
        return { seconds: combined, source: "baseLatency + outputLatency" };
      }
      return { seconds: 0, source: "none" };
    }
    if (output !== null) {
      return { seconds: output, source: "outputLatency" };
    }
    if (base !== null) {
      return { seconds: base, source: "baseLatency" };
    }
    return { seconds: 0, source: "none" };
  }

  function updateLatencyEstimate() {
    const estimate = getOutputLatencyEstimate();
    latencySource = estimate.source;
    smoothedLatencySec = smoothedLatencySec === null
      ? estimate.seconds
      : smoothedLatencySec + (estimate.seconds - smoothedLatencySec) * smoothing;
    return smoothedLatencySec;
  }

  function now() {
    if (!audioContext) return 0;
    return audioContext.currentTime - updateLatencyEstimate() - visualOffsetMs / 1000;
  }

  function setOffsetMs(value) {
    visualOffsetMs = clampVisualOffset(value);
    return visualOffsetMs;
  }

  function resetLatency() {
    smoothedLatencySec = null;
    latencySource = "none";
  }

  function getSnapshot() {
    return {
      seconds: smoothedLatencySec,
      source: latencySource,
      offsetMs: visualOffsetMs
    };
  }

  return {
    setAudioContext,
    readTimestampLatency,
    getOutputLatencyEstimate,
    now,
    setOffsetMs,
    resetLatency,
    getSnapshot
  };
}
