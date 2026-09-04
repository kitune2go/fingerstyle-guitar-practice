const zone = (path, midi = null) => Object.freeze({ path, midi });

// The catalogue stays small enough for an offline-first practice app while
// keeping transposition inside the range where a plucked string still sounds
// like the recorded instrument. Nearby recordings also provide subtle timbre
// changes when a note repeats.
export const SAMPLE_INSTRUMENTS = Object.freeze({
  nylonGuitar: Object.freeze([
    zone("assets/audio/guitar-nylon/b1.mp3", 35),
    zone("assets/audio/guitar-nylon/d2.mp3", 38),
    zone("assets/audio/guitar-nylon/e2.mp3", 40),
    zone("assets/audio/guitar-nylon/fs2.mp3", 42),
    zone("assets/audio/guitar-nylon/gs2.mp3", 44),
    zone("assets/audio/guitar-nylon/a2.mp3", 45),
    zone("assets/audio/guitar-nylon/b2.mp3", 47),
    zone("assets/audio/guitar-nylon/cs3.mp3", 49),
    zone("assets/audio/guitar-nylon/d3.mp3", 50),
    zone("assets/audio/guitar-nylon/e3.mp3", 52),
    zone("assets/audio/guitar-nylon/fs3.mp3", 54),
    zone("assets/audio/guitar-nylon/g3.mp3", 55),
    zone("assets/audio/guitar-nylon/a3.mp3", 57),
    zone("assets/audio/guitar-nylon/b3.mp3", 59),
    zone("assets/audio/guitar-nylon/cs4.mp3", 61),
    zone("assets/audio/guitar-nylon/ds4.mp3", 63),
    zone("assets/audio/guitar-nylon/e4.mp3", 64),
    zone("assets/audio/guitar-nylon/fs4.mp3", 66),
    zone("assets/audio/guitar-nylon/gs4.mp3", 68),
    zone("assets/audio/guitar-nylon/a4.mp3", 69),
    zone("assets/audio/guitar-nylon/b4.mp3", 71),
    zone("assets/audio/guitar-nylon/cs5.mp3", 73),
    zone("assets/audio/guitar-nylon/d5.mp3", 74),
    zone("assets/audio/guitar-nylon/e5.mp3", 76),
    zone("assets/audio/guitar-nylon/fs5.mp3", 78),
    zone("assets/audio/guitar-nylon/g5.mp3", 79),
    zone("assets/audio/guitar-nylon/gs5.mp3", 80),
    zone("assets/audio/guitar-nylon/a5.mp3", 81),
    zone("assets/audio/guitar-nylon/as5.mp3", 82),
  ]),
  electricBass: Object.freeze([
    zone("assets/audio/bass-electric/cs2.mp3", 37),
    zone("assets/audio/bass-electric/e2.mp3", 40),
    zone("assets/audio/bass-electric/g2.mp3", 43),
    zone("assets/audio/bass-electric/as2.mp3", 46),
    zone("assets/audio/bass-electric/e3.mp3", 52),
  ]),
  kick: Object.freeze([zone("assets/audio/drums/kick.wav")]),
  snare: Object.freeze([
    zone("assets/audio/drums/snare.wav"),
    zone("assets/audio/drums/snare-2.wav"),
    zone("assets/audio/drums/snare-3.wav"),
  ]),
  closedHat: Object.freeze([zone("assets/audio/drums/hihat-closed.wav")]),
  openHat: Object.freeze([zone("assets/audio/drums/hihat-open.wav")]),
  tom: Object.freeze([
    zone("assets/audio/drums/tom.wav"),
    zone("assets/audio/drums/tom-2.wav"),
    zone("assets/audio/drums/tom-3.wav"),
  ]),
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

const HUMAN_VARIATIONS = Object.freeze([
  Object.freeze({ cents: 0, level: 1 }),
  Object.freeze({ cents: -1.8, level: 0.97 }),
  Object.freeze({ cents: 1.2, level: 1.025 }),
  Object.freeze({ cents: -0.7, level: 0.985 }),
  Object.freeze({ cents: 1.5, level: 1.015 }),
]);

function chooseZone(zones, midi, sequence, humanize) {
  if (!humanize) return closestZone(zones, midi);

  if (!Number.isFinite(midi)) {
    return zones[sequence % zones.length];
  }

  const ranked = zones
    .filter((entry) => Number.isFinite(entry.midi))
    .map((entry, index) => ({ entry, index, distance: Math.abs(entry.midi - midi) }))
    .sort((a, b) => a.distance - b.distance || a.index - b.index);
  if (!ranked.length) return zones[sequence % zones.length];

  // Alternating between the two closest recordings avoids the repeated-note
  // "machine gun" effect without ever selecting a sample more than two
  // semitones away from an in-range target.
  const candidates = ranked.filter((candidate) => candidate.distance <= 2).slice(0, 2);
  if (!candidates.length) return ranked[0].entry;
  return candidates[sequence % candidates.length].entry;
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
  const sequences = new Map();

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
    pan = 0,
    humanize = true,
  } = {}) {
    const instrument = resolvedZones[name];
    if (!instrument) throw new Error(`Unknown sample instrument: ${name}`);

    const available = instrument.filter((entry) => buffers.has(entry.url));
    if (!available.length) return null;

    const sequence = sequences.get(name) ?? 0;
    const selected = chooseZone(available, midi, sequence, humanize);
    const variation = humanize
      ? HUMAN_VARIATIONS[sequence % HUMAN_VARIATIONS.length]
      : HUMAN_VARIATIONS[0];
    sequences.set(name, sequence + 1);
    const buffer = buffers.get(selected.url);
    const source = context.createBufferSource();
    const output = context.createGain();
    const pitchRate = Number.isFinite(midi) && Number.isFinite(selected.midi)
      ? 2 ** ((midi - selected.midi) / 12)
      : 1;
    const rate = Math.max(0.01, playbackRate * pitchRate * (2 ** (variation.cents / 1200)));
    const peak = Math.max(0.0001, gain * variation.level);
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
    let panner = null;
    if (typeof context.createStereoPanner === "function" && Number.isFinite(pan) && pan !== 0) {
      panner = context.createStereoPanner();
      panner.pan.setValueAtTime(Math.max(-1, Math.min(1, pan)), time);
      output.connect(panner);
      panner.connect(destination);
    } else {
      output.connect(destination);
    }
    source.start(time);
    source.stop(stopTime);

    return { source, output, panner, zone: selected, rate, peak, stopTime };
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
