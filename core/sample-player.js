const zone = (path, midi = null) => Object.freeze({ path, midi });

// Keep the catalogue small enough for an offline-first practice app. Pitched
// instruments use the closest recorded note and only transpose a few semitones.
export const SAMPLE_INSTRUMENTS = Object.freeze({
  nylonGuitar: Object.freeze([
    zone("assets/audio/guitar-nylon/g3.mp3", 55),
    zone("assets/audio/guitar-nylon/b3.mp3", 59),
    zone("assets/audio/guitar-nylon/e4.mp3", 64),
    zone("assets/audio/guitar-nylon/a4.mp3", 69),
    zone("assets/audio/guitar-nylon/e5.mp3", 76),
  ]),
  electricBass: Object.freeze([
    zone("assets/audio/bass-electric/e3.mp3", 52),
  ]),
  kick: Object.freeze([zone("assets/audio/drums/kick.wav")]),
  snare: Object.freeze([zone("assets/audio/drums/snare.wav")]),
  closedHat: Object.freeze([zone("assets/audio/drums/hihat-closed.wav")]),
  tom: Object.freeze([zone("assets/audio/drums/tom.wav")]),
});

export const SAMPLE_ASSET_PATHS = Object.freeze(
  [...new Set(Object.values(SAMPLE_INSTRUMENTS).flat().map((entry) => entry.path))]
);

function assetUrl(path) {
  return new URL(`../${path}`, import.meta.url).href;
}

function unique(values) {
  return [...new Set(values)];
}

function normaliseInstrumentNames(instruments, names) {
  const requested = names == null
    ? Object.keys(instruments)
    : typeof names === "string"
      ? [names]
      : Array.from(names);
  for (const name of requested) {
    if (!instruments[name]) throw new Error(`Unknown sample instrument: ${name}`);
  }
  return unique(requested);
}

function closestZone(zones, midi) {
  if (!Number.isFinite(midi)) return zones[0];
  return zones.reduce((best, current) => {
    if (!Number.isFinite(current.midi)) return best;
    if (!best || !Number.isFinite(best.midi)) return current;
    return Math.abs(current.midi - midi) < Math.abs(best.midi - midi) ? current : best;
  }, null) ?? zones[0];
}

/**
 * A small Web Audio sampler with no browser globals of its own. The caller
 * supplies both the AudioContext-like object and the fetch implementation so
 * the scheduler remains testable and the module can be reused by every page.
 */
export function createSamplePlayer({
  context,
  fetchArrayBuffer,
  instruments = SAMPLE_INSTRUMENTS,
} = {}) {
  if (!context) throw new TypeError("context is required");
  if (typeof fetchArrayBuffer !== "function") {
    throw new TypeError("fetchArrayBuffer is required");
  }

  const buffers = new Map();
  const pending = new Map();
  const failures = new Map();

  const resolvedZones = Object.fromEntries(
    Object.entries(instruments).map(([name, zones]) => [
      name,
      zones.map((entry) => ({ ...entry, url: assetUrl(entry.path) })),
    ])
  );

  async function loadUrl(url) {
    if (buffers.has(url)) return buffers.get(url);
    if (pending.has(url)) return pending.get(url);

    const request = (async () => {
      const encoded = await fetchArrayBuffer(url);
      const buffer = await context.decodeAudioData(encoded);
      buffers.set(url, buffer);
      failures.delete(url);
      return buffer;
    })();

    pending.set(url, request);
    try {
      return await request;
    } catch (error) {
      failures.set(url, error);
      throw error;
    } finally {
      pending.delete(url);
    }
  }

  function isReady(name) {
    const zones = resolvedZones[name];
    return Boolean(zones?.some((entry) => buffers.has(entry.url)));
  }

  async function load(names = null) {
    const requested = normaliseInstrumentNames(resolvedZones, names);
    const urls = unique(requested.flatMap((name) => resolvedZones[name].map((entry) => entry.url)));
    await Promise.allSettled(urls.map(loadUrl));

    return {
      requested,
      loaded: requested.filter(isReady),
      failed: requested.filter((name) => !isReady(name)),
    };
  }

  function schedule(name, {
    time = context.currentTime,
    destination = context.destination,
    midi = null,
    gain = 1,
    duration = null,
    playbackRate = 1,
    attack = 0.003,
    release = 0.055,
  } = {}) {
    const instrument = resolvedZones[name];
    if (!instrument) throw new Error(`Unknown sample instrument: ${name}`);

    const available = instrument.filter((entry) => buffers.has(entry.url));
    if (!available.length) return null;

    const selected = closestZone(available, midi);
    const buffer = buffers.get(selected.url);
    const source = context.createBufferSource();
    const output = context.createGain();
    const pitchRate = Number.isFinite(midi) && Number.isFinite(selected.midi)
      ? 2 ** ((midi - selected.midi) / 12)
      : 1;
    const rate = Math.max(0.01, playbackRate * pitchRate);
    const peak = Math.max(0.0001, gain);
    const naturalDuration = buffer.duration / rate;
    const audibleDuration = Number.isFinite(duration)
      ? Math.max(0.02, Math.min(duration, naturalDuration))
      : naturalDuration;
    const attackTime = Math.min(Math.max(0, attack), audibleDuration / 3);
    const releaseTime = Math.min(Math.max(0.008, release), audibleDuration / 2);
    const releaseStart = time + Math.max(attackTime, audibleDuration - releaseTime);
    const stopTime = time + audibleDuration + 0.01;

    source.buffer = buffer;
    source.playbackRate.setValueAtTime(rate, time);
    output.gain.setValueAtTime(0.0001, time);
    output.gain.linearRampToValueAtTime(peak, time + attackTime);
    output.gain.setValueAtTime(peak, releaseStart);
    output.gain.exponentialRampToValueAtTime(0.0001, time + audibleDuration);

    source.connect(output);
    output.connect(destination);
    source.start(time);
    source.stop(stopTime);

    return { source, output, zone: selected, rate, stopTime };
  }

  return {
    load,
    schedule,
    isReady,
    failureFor(path) {
      return failures.get(assetUrl(path)) ?? null;
    },
  };
}
