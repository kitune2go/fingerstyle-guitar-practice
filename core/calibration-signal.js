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

/**
 * Creates the CalibrationProcessor class inheriting from the provided BaseAudioWorkletProcessor.
 * Realm-specific globals (sampleRate, currentFrame, currentTime) are strictly injected via getScopeGlobals,
 * keeping core free from any realm or global scope dependencies.
 */
export function createCalibrationProcessorClass(BaseAudioWorkletProcessor, getScopeGlobals) {
  if (typeof BaseAudioWorkletProcessor !== "function") {
    throw new TypeError("BaseAudioWorkletProcessor must be a constructor function");
  }
  if (typeof getScopeGlobals !== "function") {
    throw new TypeError("getScopeGlobals must be a function returning { sampleRate, currentFrame, currentTime }");
  }

  return class CalibrationProcessor extends BaseAudioWorkletProcessor {
    constructor() {
      super();
      const scope = getScopeGlobals();
      if (!scope || typeof scope.sampleRate !== "number" || typeof scope.currentFrame !== "number" || typeof scope.currentTime !== "number") {
        throw new TypeError("getScopeGlobals() must return an object with numeric sampleRate, currentFrame, and currentTime");
      }
      this._getScopeGlobals = getScopeGlobals;
      this.sampleRate = scope.sampleRate;
      this.template = generateReferenceBurst(this.sampleRate);
      this.ringBuffer = new Float32Array(this.template.length * 4);
      this.ringWrite = 0;
      this.ringCount = 0;
      this.active = true;
      this.lastDetectionFrame = -Infinity;
      this.minIntervalFrames = Math.round(this.sampleRate * 0.1); // min 100 ms between detections
      this.tracking = false;
      this.peakScore = 0;
      this.peakSampleGlobal = -1;
      this.samplesRemaining = 0;
      this.searchWindowSamples = Math.round(this.sampleRate * 0.015); // 15 ms peak search window

      this.port.onmessage = (event) => {
        if (event.data?.type === "reset") {
          this.ringWrite = 0;
          this.ringCount = 0;
          this.lastDetectionFrame = -Infinity;
          this.tracking = false;
          this.peakScore = 0;
          this.peakSampleGlobal = -1;
          this.samplesRemaining = 0;
          this.active = true;
        } else if (event.data?.type === "stop") {
          this.active = false;
        }
      };
    }

    process(inputs, outputs, parameters) {
      if (!this.active) return true;
      const input = inputs[0];
      if (!input || !input[0] || input[0].length === 0) return true;
      const channel = input[0];
      const blockSize = channel.length;
      const templateLen = this.template.length;
      const scope = this._getScopeGlobals();
      const curFrame = scope.currentFrame;
      const curTime = scope.currentTime;
      const sRate = this.sampleRate;

      // Push into ring buffer and analyze
      for (let i = 0; i < blockSize; i++) {
        const sample = channel[i];
        this.ringBuffer[this.ringWrite] = sample;
        this.ringWrite = (this.ringWrite + 1) % this.ringBuffer.length;
        if (this.ringCount < this.ringBuffer.length) this.ringCount++;

        // Once we have at least templateLen samples in the buffer, evaluate correlation
        if (this.ringCount >= templateLen) {
          // Read back the last templateLen samples in chronological order
          let dot = 0;
          let inEnergy = 0;
          let tmplEnergy = 0;
          const startRead = (this.ringWrite - templateLen + this.ringBuffer.length) % this.ringBuffer.length;

          for (let t = 0; t < templateLen; t++) {
            const inVal = this.ringBuffer[(startRead + t) % this.ringBuffer.length];
            const tmplVal = this.template[t];
            dot += inVal * tmplVal;
            inEnergy += inVal * inVal;
            tmplEnergy += tmplVal * tmplVal;
          }

          const denom = Math.sqrt(inEnergy * tmplEnergy);
          const score = denom > 1e-6 ? dot / denom : 0;

          const currentSampleGlobal = curFrame + i;

          if (!this.tracking) {
            if (score >= CALIBRATION_CORRELATION_THRESHOLD &&
                (currentSampleGlobal - this.lastDetectionFrame) >= this.minIntervalFrames) {
              this.tracking = true;
              this.peakScore = score;
              this.peakSampleGlobal = currentSampleGlobal;
              this.samplesRemaining = this.searchWindowSamples;
            }
          } else {
            if (score > this.peakScore) {
              this.peakScore = score;
              this.peakSampleGlobal = currentSampleGlobal;
            }
            this.samplesRemaining--;
            if (this.samplesRemaining <= 0) {
              this.lastDetectionFrame = this.peakSampleGlobal;
              const onsetSampleGlobal = this.peakSampleGlobal - (templateLen - 1);
              // Derive observedTime on the exact AudioContext timebase
              const sampleTimeOffset = (this.peakSampleGlobal - curFrame) / sRate;
              const observedTime = curTime + sampleTimeOffset - (templateLen - 1) / sRate;

              this.port.postMessage({
                type: "onset",
                observedTime,
                observedFrame: onsetSampleGlobal,
                score: this.peakScore
              });

              this.tracking = false;
              this.peakScore = 0;
              this.peakSampleGlobal = -1;
            }
          }
        }
      }

      return true;
    }
  };
}
