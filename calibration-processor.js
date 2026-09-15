// Realm-specific AudioWorklet registration adapter for acoustic latency calibration
import { createCalibrationProcessorClass } from './core/calibration-signal.js';

const CalibrationProcessor = createCalibrationProcessorClass(
  AudioWorkletProcessor,
  () => ({
    sampleRate,
    currentFrame,
    currentTime
  })
);

registerProcessor('calibration-processor', CalibrationProcessor);
