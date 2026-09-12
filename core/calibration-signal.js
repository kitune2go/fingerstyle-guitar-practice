// Reference signal specifications for round-trip acoustic calibration
export const CALIBRATION_BURST_FREQ_HZ = 2500;
export const CALIBRATION_BURST_DURATION_SEC = 0.010; // 10 ms
export const CALIBRATION_CORRELATION_THRESHOLD = 0.35; // Normalized correlation threshold

// Synthesizes the reference 2.5 kHz burst with Hann window fade-in/fade-out
export function generateReferenceBurst(sampleRate) {
  const length = Math.max(1, Math.round(sampleRate * CALIBRATION_BURST_DURATION_SEC));
  const buffer = new Float32Array(length);
  const angularFreq = 2 * Math.PI * CALIBRATION_BURST_FREQ_HZ;
  for (let i = 0; i < length; i++) {
    const t = i / sampleRate;
    // Hann window
    const window = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (length - 1)));
    buffer[i] = Math.sin(angularFreq * t) * window;
  }
  return buffer;
}

// Compute normalized cross correlation at a given offset
// template is Float32Array, input is Float32Array
export function computeNormalizedCorrelation(input, offset, template) {
  let dot = 0;
  let inputEnergy = 0;
  let templateEnergy = 0;
  const len = template.length;

  for (let i = 0; i < len; i++) {
    const inVal = input[offset + i];
    const tmplVal = template[i];
    dot += inVal * tmplVal;
    inputEnergy += inVal * inVal;
    templateEnergy += tmplVal * tmplVal;
  }

  const denom = Math.sqrt(inputEnergy * templateEnergy);
  return denom > 1e-6 ? dot / denom : 0;
}
