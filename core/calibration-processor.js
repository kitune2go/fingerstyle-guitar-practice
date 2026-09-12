import {
  CALIBRATION_BURST_FREQ_HZ,
  CALIBRATION_BURST_DURATION_SEC,
  CALIBRATION_CORRELATION_THRESHOLD,
  generateReferenceBurst
} from "./calibration-signal.js";

class CalibrationProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.template = generateReferenceBurst(sampleRate);
    this.ringBuffer = new Float32Array(this.template.length * 4);
    this.ringWrite = 0;
    this.ringCount = 0;
    this.active = true;
    this.lastDetectionFrame = -Infinity;
    this.minIntervalFrames = Math.round(sampleRate * 0.1); // min 100 ms between detections

    this.port.onmessage = (event) => {
      if (event.data?.type === "reset") {
        this.ringWrite = 0;
        this.ringCount = 0;
        this.lastDetectionFrame = -Infinity;
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

        const currentSampleGlobal = currentFrame + i;
        if (score >= CALIBRATION_CORRELATION_THRESHOLD &&
            (currentSampleGlobal - this.lastDetectionFrame) >= this.minIntervalFrames) {
          this.lastDetectionFrame = currentSampleGlobal;

          // The onset of the detected burst starts (templateLen - 1) samples before this instant
          const onsetSampleGlobal = currentSampleGlobal - (templateLen - 1);
          // AudioWorklet currentTime at the start of this block + offset to onset
          const sampleTimeOffset = (i - (templateLen - 1)) / sampleRate;
          const observedTime = currentTime + sampleTimeOffset;

          this.port.postMessage({
            type: "onset",
            observedTime,
            observedFrame: onsetSampleGlobal,
            score
          });
        }
      }
    }

    return true;
  }
}

registerProcessor("calibration-processor", CalibrationProcessor);
