import { getEffectiveEventGain } from "../pattern-model.js";

export function createAudioEngine({
  partDefs,
  contextFactory,
  samplePlayerFactory = null
}) {
  if (typeof contextFactory !== "function") {
    throw new TypeError("contextFactory is required");
  }

  let audioContext = null;
  let activeParts = new Set();
  let samplePlayer = null;
  let soundMode = "samples";
  const partGainBuses = new Map();

  function getContext() {
    return audioContext;
  }

  function ensurePartGainBuses() {
    if (!audioContext) return;

    for (const part of partDefs) {
      if (partGainBuses.has(part.key)) continue;

      const bus = audioContext.createGain();
      bus.gain.value = activeParts.has(part.key) ? 1 : 0;
      bus.connect(audioContext.destination);
      partGainBuses.set(part.key, bus);
    }
  }

  async function start(parts) {
    activeParts = new Set(parts);

    if (!audioContext) {
      audioContext = contextFactory();
      if (typeof samplePlayerFactory === "function") {
        samplePlayer = samplePlayerFactory(audioContext);
      }
    }
    if (audioContext.state === "suspended") {
      await audioContext.resume();
    }

    ensurePartGainBuses();
    return audioContext;
  }

  function setSoundMode(mode) {
    soundMode = mode === "synth" ? "synth" : "samples";
    return soundMode;
  }

  async function loadSamples(names) {
    const requested = typeof names === "string" ? [names] : Array.from(names || []);
    if (!samplePlayer) return { requested, loaded: [], failed: requested };
    return samplePlayer.load(requested);
  }

  function setActiveParts(parts) {
    activeParts = new Set(parts);
    if (!audioContext) return;

    ensurePartGainBuses();
    for (const part of partDefs) {
      const bus = partGainBuses.get(part.key);
      if (!bus) continue;

      bus.gain.cancelScheduledValues(audioContext.currentTime);
      bus.gain.setTargetAtTime(
        activeParts.has(part.key) ? 1 : 0,
        audioContext.currentTime,
        0.006
      );
    }
  }

  function makeClick(time, part, event) {
    if (!audioContext) return false;

    const peakGain = getEffectiveEventGain(part.gain, event);

    // A zero-velocity event remains visible and keeps its timing position, but
    // Web Audio exponential ramps require a strictly positive target.
    if (peakGain <= 0) return false;

    ensurePartGainBuses();
    const bus = partGainBuses.get(part.key);
    const sampleName = event?.accent && part.accentSample ? part.accentSample : part.sample;
    const sampleDuration = event?.accent && part.accentSampleDuration
      ? part.accentSampleDuration
      : part.sampleDuration;
    const sampled = soundMode === "samples" && sampleName && samplePlayer?.schedule(sampleName, {
      time,
      destination: bus,
      gain: getEffectiveEventGain(part.sampleGain ?? part.gain, event),
      duration: sampleDuration ?? null,
      release: 0.04,
      pan: part.samplePan ?? 0
    });
    if (sampled) return true;

    const osc = audioContext.createOscillator();
    const gain = audioContext.createGain();

    osc.type = part.key === "foot" ? "sine" : "triangle";
    osc.frequency.setValueAtTime(part.freq, time);

    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.exponentialRampToValueAtTime(peakGain, time + 0.0025);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + part.duration);

    osc.connect(gain);
    gain.connect(bus);

    osc.start(time);
    osc.stop(time + part.duration + 0.012);
    return true;
  }

  return {
    getContext,
    start,
    setSoundMode,
    loadSamples,
    setActiveParts,
    makeClick
  };
}
