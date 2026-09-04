import { createSamplePlayer } from "./core/sample-player.js";
import {
  patterns,
  getBarIndex,
  getEventAtStep,
  getPulseIndex,
  isBarBoundary
} from "./rhythm/pattern-model.js";
import { createAudioEngine } from "./rhythm/core/audio-engine.js";
import {
  createScheduler,
  START_DELAY_SEC
} from "./rhythm/core/scheduler.js";
import {
  createVisualClock,
  formatLatencyReadout,
  formatVisualOffset
} from "./rhythm/core/visual-clock.js";
import { createGhostMode } from "./rhythm/modes/ghost-mode.js";
import { createGridView } from "./rhythm/views/grid-view.js";
import { createOrbitView } from "./rhythm/views/orbit-view.js";

const SOUND_MODE_KEY = "fingerstyle-sound-mode";
const RHYTHM_SAMPLES = ["tom", "closedHat", "openHat", "snare", "kick"];

const partDefs = [
  { key: "voice", label: "Voice", sample: "tom", sampleGain: 0.12, sampleDuration: 0.16, samplePan: -0.1, freq: 920, gain: 0.095, duration: 0.030 },
  { key: "right", label: "R.Hand", sample: "closedHat", accentSample: "openHat", sampleGain: 0.09, sampleDuration: 0.07, accentSampleDuration: 0.2, samplePan: -0.26, freq: 690, gain: 0.085, duration: 0.026 },
  { key: "left", label: "L.Hand", sample: "snare", sampleGain: 0.12, sampleDuration: 0.14, samplePan: 0.18, freq: 460, gain: 0.085, duration: 0.032 },
  { key: "foot", label: "Foot", sample: "kick", sampleGain: 0.17, sampleDuration: 0.20, samplePan: 0, freq: 150, gain: 0.15, duration: 0.060 }
];

const bpmRange = document.getElementById("bpmRange");
const bpmNumber = document.getElementById("bpmNumber");
const bpmLabel = document.getElementById("bpmLabel");
const startBtn = document.getElementById("startBtn");
const stopBtn = document.getElementById("stopBtn");
const beatDisplay = document.getElementById("beatDisplay");
const stateText = document.getElementById("stateText");
const meterDisplay = document.getElementById("meterDisplay");
const barDisplay = document.getElementById("barDisplay");
const pulseDisplay = document.getElementById("pulseDisplay");
const board = document.getElementById("board");
const legend = document.getElementById("legend");
const partButtons = document.getElementById("partButtons");
const addLayerBtn = document.getElementById("addLayerBtn");
const resetLayerBtn = document.getElementById("resetLayerBtn");
const layerCount = document.getElementById("layerCount");
const patternSelect = document.getElementById("patternSelect");
const patternInfo = document.getElementById("patternInfo");
const gridViewBtn = document.getElementById("gridViewBtn");
const orbitViewBtn = document.getElementById("orbitViewBtn");
const ghostBtn = document.getElementById("ghostBtn");
const ghostStatus = document.getElementById("ghostStatus");
const soundModeBtn = document.getElementById("soundModeBtn");
const soundModeNote = document.getElementById("soundModeNote");
const gridViewElement = document.getElementById("gridView");
const orbitViewElement = document.getElementById("orbitView");
const orbitSvg = document.getElementById("orbitSvg");
const offsetRange = document.getElementById("offsetRange");
const offsetLabel = document.getElementById("offsetLabel");
const offsetResetBtn = document.getElementById("offsetResetBtn");
const latencyReadout = document.getElementById("latencyReadout");

const activeParts = new Set(["voice"]);
const visualQueue = [];

let currentPatternKey = "basic";
let currentView = "orbit";
let running = false;
let rafId = null;
let shownStep = -1;
let starting = false;
let startGeneration = 0;
let soundMode = readSoundMode();
let sampleLoad = null;

const visualClock = createVisualClock();
const audioEngine = createAudioEngine({
  partDefs,
  contextFactory: createBrowserAudioContext,
  samplePlayerFactory: context => createSamplePlayer({ context, fetchArrayBuffer })
});
audioEngine.setSoundMode(soundMode);
const ghostMode = createGhostMode();
const grid = createGridView({ board, partDefs, meterLabel });
const orbit = createOrbitView({ svg: orbitSvg, partDefs });
const scheduler = createScheduler({
  getCurrentTime: () => audioEngine.getContext()?.currentTime ?? 0,
  getPattern: currentPattern,
  getBpm: () => clampBpm(bpmNumber.value),
  onScheduleStep: scheduleStep
});

function createBrowserAudioContext() {
  const AudioContextConstructor = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextConstructor) {
    throw new Error("このブラウザはWeb Audioに対応していません。");
  }
  return new AudioContextConstructor({ latencyHint: "interactive" });
}

async function fetchArrayBuffer(url) {
  const response = await fetch(url, { cache: "force-cache" });
  if (!response.ok) throw new Error(response.status + " " + response.statusText);
  return response.arrayBuffer();
}

function readSoundMode() {
  try {
    return localStorage.getItem(SOUND_MODE_KEY) === "synth" ? "synth" : "samples";
  } catch {
    return "samples";
  }
}

function saveSoundMode() {
  try {
    localStorage.setItem(SOUND_MODE_KEY, soundMode);
  } catch (error) {
    console.warn("[rhythm] could not save sound mode:", error);
  }
}

function renderSoundMode(status = "idle") {
  const real = soundMode === "samples";
  if (!real && status !== "failed") status = "idle";
  const labels = {
    idle: real ? "音色：リアル" : "音色：合成",
    loading: "音色：読込中…",
    partial: "音色：リアル（一部）",
    failed: "音源失敗：合成"
  };
  const notes = {
    idle: real
      ? "Voice＝3種のタム／右手＝ハイハット／左手＝3種のスネア／足＝キック"
      : "4パートを高さの違う合成クリックで再生",
    loading: "打楽器サンプルを読み込んでいます",
    partial: "読めないパートだけ合成クリックで補います",
    failed: "サンプルを読めないため合成クリックで再生します"
  };
  soundModeBtn.textContent = labels[status] || labels.idle;
  soundModeNote.textContent = notes[status] || notes.idle;
  soundModeBtn.setAttribute("aria-pressed", String(real));
  soundModeBtn.setAttribute("aria-busy", String(status === "loading"));
  soundModeBtn.setAttribute(
    "aria-label",
    real ? "リアル音源を使用中。合成音に切り替える" : "合成音を使用中。リアル音源に切り替える"
  );
}

async function prepareRealSamples() {
  if (soundMode !== "samples" || !audioEngine.getContext()) return null;
  if (!sampleLoad) {
    renderSoundMode("loading");
    sampleLoad = audioEngine.loadSamples(RHYTHM_SAMPLES).finally(() => {
      sampleLoad = null;
    });
  }

  try {
    const result = await sampleLoad;
    if (soundMode !== "samples") return result;
    if (result.loaded.length === 0) {
      soundMode = "synth";
      audioEngine.setSoundMode(soundMode);
      renderSoundMode("failed");
    } else {
      renderSoundMode(result.failed.length === 0 ? "idle" : "partial");
    }
    return result;
  } catch (error) {
    console.warn("[rhythm] sample load failed; using synthesis:", error);
    soundMode = "synth";
    audioEngine.setSoundMode(soundMode);
    renderSoundMode("failed");
    return { requested: RHYTHM_SAMPLES, loaded: [], failed: RHYTHM_SAMPLES };
  }
}

function toggleSoundMode() {
  soundMode = soundMode === "samples" ? "synth" : "samples";
  audioEngine.setSoundMode(soundMode);
  saveSoundMode();
  renderSoundMode();
  if (soundMode === "samples" && audioEngine.getContext()) {
    void prepareRealSamples();
  }
}

function currentPattern() {
  return patterns[currentPatternKey];
}

function currentEvents(key) {
  return currentPattern().events[key] || [];
}

function pulseUnitLabel(unit) {
  const labels = {
    quarter: "4分音符",
    "dotted-quarter": "付点4分音符",
    eighth: "8分音符",
    half: "2分音符"
  };
  return labels[unit] || unit;
}

function meterLabel(pattern) {
  return pattern.meter.numerator + "/" + pattern.meter.denominator;
}

function updatePatternStatus(pattern = currentPattern()) {
  meterDisplay.textContent = meterLabel(pattern) + " ・ " + pattern.bars + "小節";
  patternInfo.textContent =
    pattern.description +
    " 推奨開始BPM: " + pattern.defaultBpm +
    "（1拍 = " + pulseUnitLabel(pattern.pulse.unit) +
    "、" + pattern.pulse.count + " pulse/小節）";
}

function clampBpm(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 60;
  return Math.min(200, Math.max(40, Math.round(n)));
}

function setBpm(value) {
  const bpm = clampBpm(value);
  bpmRange.value = bpm;
  bpmNumber.value = bpm;
  bpmLabel.textContent = bpm;
}

function setVisualOffset(value) {
  const offsetMs = visualClock.setOffsetMs(value);
  offsetRange.value = String(offsetMs);
  offsetLabel.textContent = formatVisualOffset(offsetMs);
}

function updateLatencyReadout() {
  latencyReadout.textContent = formatLatencyReadout(visualClock.getSnapshot());
}

function buildPatternSelect() {
  patternSelect.innerHTML = "";
  for (const [key, pattern] of Object.entries(patterns)) {
    const option = document.createElement("option");
    option.value = key;
    option.textContent = pattern.family + " — " + pattern.name;
    patternSelect.appendChild(option);
  }
  patternSelect.value = currentPatternKey;
}

function buildPartButtons() {
  partButtons.innerHTML = "";
  for (const part of partDefs) {
    const button = document.createElement("button");
    button.className = "part-toggle";
    button.dataset.partButton = part.key;
    button.textContent = part.label;
    button.addEventListener("click", () => togglePart(part.key));
    partButtons.appendChild(button);
  }
  updatePartUI();
}

function buildBoard() {
  const pattern = currentPattern();
  grid.build(pattern);
  orbit.build(pattern, 0);

  updatePatternStatus(pattern);
  legend.textContent =
    partDefs
      .map(part => part.label + ": " + currentEvents(part.key).length + " hits/" + pattern.bars + " bar")
      .join(" ／ ");

  barDisplay.textContent = "小節 1 / " + pattern.bars;
  pulseDisplay.textContent =
    "Pulse 1 / " + pattern.pulse.count + "（" + pulseUnitLabel(pattern.pulse.unit) + "）";
  updatePartUI();
}

function setView(view) {
  currentView = view === "grid" ? "grid" : "orbit";
  const gridActive = currentView === "grid";

  gridViewElement.classList.toggle("hidden", !gridActive);
  orbitViewElement.classList.toggle("hidden", gridActive);
  gridViewBtn.classList.toggle("active", gridActive);
  orbitViewBtn.classList.toggle("active", !gridActive);
}

function updateVisualPartState() {
  grid.setActiveParts(activeParts);
  orbit.setState(activeParts, ghostMode.getVisibleMutedParts());
}

function resetGhostCycle() {
  ghostMode.reset();
  updateGhostUI();
  updateVisualPartState();
}

function toggleGhostMode() {
  ghostMode.toggle();
  updateGhostUI();
  updateVisualPartState();
}

function updateGhostUI() {
  const enabled = ghostMode.isEnabled();
  ghostBtn.classList.toggle("active", enabled);
  ghostBtn.textContent = enabled ? "👻 GHOST ON" : "👻 GHOST OFF";

  if (!enabled) {
    ghostStatus.textContent =
      "GhostはOFF。ONにすると4小節ごとに1パートずつ音が消えます。";
    return;
  }

  if (activeParts.size <= 1) {
    ghostStatus.textContent =
      "GHOST待機中：2パート以上を重ねると作動します。";
    return;
  }

  const visibleMutedParts = ghostMode.getVisibleMutedParts();
  const mutedLabels = partDefs
    .filter(part => visibleMutedParts.has(part.key))
    .map(part => part.label);

  const barsRemaining = ghostMode.getBarsRemaining();
  ghostStatus.textContent = mutedLabels.length
    ? "消音中: " + mutedLabels.join(" + ") + " ／ 次の変化まで約" + barsRemaining + "小節"
    : "全パート聴こえています ／ 約" + barsRemaining + "小節後に1パート消えます";
}

function togglePart(key) {
  if (activeParts.has(key)) activeParts.delete(key);
  else activeParts.add(key);

  audioEngine.setActiveParts(activeParts);
  resetGhostCycle();
  updatePartUI();
}

function addNextPart() {
  const next = partDefs.find(part => !activeParts.has(part.key));
  if (!next) return;

  activeParts.add(next.key);
  audioEngine.setActiveParts(activeParts);
  resetGhostCycle();
  updatePartUI();
}

function resetToVoice() {
  for (const part of partDefs) {
    if (part.key === "voice") activeParts.add(part.key);
    else activeParts.delete(part.key);
  }

  audioEngine.setActiveParts(activeParts);
  resetGhostCycle();
  updatePartUI();
}

function updatePartUI() {
  document.querySelectorAll("[data-part-button]").forEach(button => {
    const enabled = activeParts.has(button.dataset.partButton);
    button.classList.toggle("active", enabled);
    button.setAttribute("aria-pressed", String(enabled));
  });

  layerCount.textContent = activeParts.size + " / " + partDefs.length;
  addLayerBtn.disabled = activeParts.size === partDefs.length;
  addLayerBtn.textContent =
    activeParts.size === partDefs.length ? "✓ 全パートON" : "＋ 次のパートを重ねる";

  updateVisualPartState();
  updateGhostUI();
}

async function applyPattern(key) {
  const wasRunning = running;
  if (wasRunning) stop();

  currentPatternKey = key;
  patternSelect.value = key;
  setBpm(currentPattern().defaultBpm);
  resetToVoice();
  buildBoard();

  if (wasRunning) {
    await start();
  }
}

function scheduleStep(step, time) {
  const pattern = currentPattern();
  ghostMode.handleScheduledStep(pattern, step, time, activeParts);

  for (const part of partDefs) {
    const event = getEventAtStep(pattern, part.key, step);
    if (
      activeParts.has(part.key) &&
      !ghostMode.isPartMuted(part.key) &&
      event
    ) {
      audioEngine.makeClick(time, part, event);
    }
  }

  visualQueue.push({ step, time });
}

function renderStep(step) {
  if (step === shownStep) return;

  const pattern = currentPattern();
  const barIndex = getBarIndex(pattern, step);
  const pulseIndex = getPulseIndex(pattern, step);

  if (isBarBoundary(pattern, step)) {
    ghostMode.handleRenderedStep(pattern, step);
    updateGhostUI();
  }

  grid.renderStep(step);

  const pulse = String(pulseIndex + 1);
  orbit.renderStep(pattern, step, pulse);

  beatDisplay.textContent = pulse;
  barDisplay.textContent = "小節 " + (barIndex + 1) + " / " + pattern.bars;
  pulseDisplay.textContent =
    "Pulse " + (pulseIndex + 1) + " / " + pattern.pulse.count +
    "（" + pulseUnitLabel(pattern.pulse.unit) + "）";

  shownStep = step;
}

function visualLoop() {
  const audioContext = audioEngine.getContext();
  if (!running || !audioContext) return;

  const visualNow = visualClock.now();

  if (ghostMode.flushVisibleQueue(visualNow)) {
    updateGhostUI();
    updateVisualPartState();
  }

  while (visualQueue.length && visualQueue[0].time <= visualNow) {
    renderStep(visualQueue.shift().step);
  }

  updateLatencyReadout();
  rafId = requestAnimationFrame(visualLoop);
}

function clearVisuals() {
  visualQueue.length = 0;
  shownStep = -1;

  grid.clear();
  orbit.clear();

  beatDisplay.textContent = "—";
  const pattern = currentPattern();
  barDisplay.textContent = "小節 — / " + pattern.bars;
  pulseDisplay.textContent =
    "Pulse — / " + pattern.pulse.count + "（" + pulseUnitLabel(pattern.pulse.unit) + "）";
}

async function start() {
  if (running || starting) return;
  starting = true;
  startBtn.disabled = true;

  const attempt = ++startGeneration;
  let audioContext;

  try {
    audioContext = await audioEngine.start(activeParts);
    visualClock.setAudioContext(audioContext);
    if (soundMode === "samples") await prepareRealSamples();
  } catch (error) {
    starting = false;
    startBtn.disabled = false;
    stateText.textContent = "音声を開始できませんでした";
    return;
  }

  starting = false;

  if (attempt !== startGeneration) {
    startBtn.disabled = running;
    return;
  }

  resetGhostCycle();
  running = true;
  clearVisuals();
  visualClock.resetLatency();

  stopBtn.disabled = false;
  stateText.textContent = "再生中";

  scheduler.start(audioContext.currentTime + START_DELAY_SEC);
  rafId = requestAnimationFrame(visualLoop);
}

function stop() {
  running = false;
  starting = false;
  startGeneration += 1;

  scheduler.stop();
  if (rafId !== null) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }

  startBtn.disabled = false;
  stopBtn.disabled = true;
  stateText.textContent = "停止中";
  clearVisuals();
  resetGhostCycle();
  visualClock.resetLatency();
  updateLatencyReadout();
}

bpmRange.addEventListener("input", event => setBpm(event.target.value));
bpmNumber.addEventListener("input", event => setBpm(event.target.value));
patternSelect.addEventListener("change", event => applyPattern(event.target.value));
startBtn.addEventListener("click", start);
stopBtn.addEventListener("click", stop);
addLayerBtn.addEventListener("click", addNextPart);
resetLayerBtn.addEventListener("click", resetToVoice);
gridViewBtn.addEventListener("click", () => setView("grid"));
orbitViewBtn.addEventListener("click", () => setView("orbit"));
ghostBtn.addEventListener("click", toggleGhostMode);
soundModeBtn.addEventListener("click", toggleSoundMode);
offsetRange.addEventListener("input", event => setVisualOffset(event.target.value));
offsetResetBtn.addEventListener("click", () => setVisualOffset(0));

buildPatternSelect();
buildPartButtons();
setBpm(currentPattern().defaultBpm);
buildBoard();
setView(currentView);
setVisualOffset(0);
renderSoundMode();
updateGhostUI();
updateLatencyReadout();
