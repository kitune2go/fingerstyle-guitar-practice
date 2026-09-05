import { createScheduler } from "./core/clock.js";
import { createSamplePlayer } from "./core/sample-player.js";

(() => {
  "use strict";

  const app = document.getElementById("practice-app");
  if (!app) return;

  const byId = (id) => document.getElementById(id);
  const SOUND_MODE_KEY = "fingerstyle-sound-mode";
  // Both resolved against the document so they are comparable, and so the
  // fallback stays inside the deployment (a project GitHub Pages site is served
  // from a subpath, where an origin-relative "/data/" is always a 404).
  const source = new URL(app.dataset.source || "./data", document.baseURI).href.replace(/\/$/, "");
  const localFallback = new URL("./data", document.baseURI).href.replace(/\/$/, "");

  const state = {
    index: null,
    dataRoot: source,
    position: 0,
    lesson: null,
    completed: new Set(),
    tempo: 60,
    metronomeScheduler: null,
    metronomeRunning: false,
    beatInBar: 0,
    audioContext: null,
    samplePlayer: null,
    sampleLoad: null,
    soundMode: readSoundMode(),
    metronomeStarting: false,
    metronomeSources: new Set(),
    metronomePulseTimers: new Set(),
    lessonPlaybackStarting: false,
    lessonPlaybackGeneration: 0,
    lessonPlaybackSources: new Set(),
  };

  const METRONOME_SAMPLES = ["closedHat", "tom"];
  const OPEN_STRING_MIDI = Object.freeze({ 1: 64, 2: 59, 3: 55, 4: 50, 5: 45, 6: 40 });

  function readSoundMode() {
    try {
      return localStorage.getItem(SOUND_MODE_KEY) === "synth" ? "synth" : "samples";
    } catch {
      return "samples";
    }
  }

  function saveSoundMode() {
    try {
      localStorage.setItem(SOUND_MODE_KEY, state.soundMode);
    } catch (error) {
      console.warn("[app] could not save sound mode:", error);
    }
  }

  function renderSoundMode(status = "idle") {
    const button = byId("sound-mode-toggle");
    if (!button) return;

    const real = state.soundMode === "samples";
    if (!real && status !== "failed") status = "idle";
    const labels = {
      idle: real ? "音色：リアル" : "音色：合成",
      loading: "音色：読込中…",
      partial: "音色：リアル（一部）",
      failed: "音源失敗：合成",
    };
    button.textContent = labels[status] ?? labels.idle;
    button.setAttribute("aria-pressed", String(real));
    button.setAttribute("aria-busy", String(status === "loading"));
    button.setAttribute(
      "aria-label",
      real ? "リアル音源を使用中。合成音に切り替える" : "合成音を使用中。リアル音源に切り替える"
    );
  }

  async function fetchArrayBuffer(url) {
    const response = await fetch(url, { cache: "force-cache" });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    return response.arrayBuffer();
  }

  async function prepareRealSamples(names = METRONOME_SAMPLES) {
    if (state.soundMode !== "samples" || !state.audioContext) return;
    if (!state.samplePlayer) {
      state.samplePlayer = createSamplePlayer({
        context: state.audioContext,
        fetchArrayBuffer,
      });
    }
    const requested = typeof names === "string" ? [names] : [...names];
    const key = [...requested].sort().join("|");
    if (!state.sampleLoad || state.sampleLoad.key !== key) {
      renderSoundMode("loading");
      const promise = state.samplePlayer.load(requested).finally(() => {
        if (state.sampleLoad?.promise === promise) state.sampleLoad = null;
      });
      state.sampleLoad = { key, promise };
    }

    const result = await state.sampleLoad.promise;
    if (state.soundMode !== "samples") return result;
    if (result.loaded.length === 0) {
      // Retry after a reload, but expose and use the effective fallback for the
      // rest of this session instead of announcing unavailable samples.
      state.soundMode = "synth";
      renderSoundMode("failed");
    } else {
      renderSoundMode(result.failed.length === 0 ? "idle" : "partial");
    }
    return result;
  }

  const escapeHtml = (value) =>
    String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");

  const joinUrl = (root, path) => `${root.replace(/\/$/, "")}/${String(path).replace(/^\//, "")}`;

  async function fetchJson(url) {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    return response.json();
  }

  async function loadIndex() {
    const candidates = source === localFallback ? [source] : [source, localFallback];
    let lastError;
    for (const root of candidates) {
      try {
        const index = await fetchJson(joinUrl(root, "lessons-index.json"));
        return { index, root };
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError ?? new Error("教材索引を読み込めませんでした。");
  }

  function formatDate(value) {
    const parts = String(value).split("-");
    if (parts.length !== 3) return value;
    return `${parts[0]}.${parts[1]}.${parts[2]}`;
  }

  function progressKey() {
    return `fingerstyle-progress:${state.lesson?.id ?? "unknown"}`;
  }

  function readProgress() {
    try {
      const saved = JSON.parse(localStorage.getItem(progressKey()) || "[]");
      state.completed = new Set(Array.isArray(saved) ? saved : []);
    } catch {
      state.completed = new Set();
    }
  }

  function saveProgress() {
    try {
      localStorage.setItem(progressKey(), JSON.stringify([...state.completed]));
    } catch (error) {
      console.warn("[app] could not save progress:", error);
    }
  }

  function setText(id, value) {
    const node = byId(id);
    if (node) node.textContent = String(value ?? "");
  }

  function renderRoutine() {
    const list = byId("routine-list");
    if (!list || !state.lesson) return;
    list.innerHTML = state.lesson.routine
      .map((step) => {
        const done = state.completed.has(step.id);
        const tab = Array.isArray(step.tab) && step.tab.length
          ? `<pre class="routine-mini-tab">${escapeHtml(step.tab.join("\n"))}</pre>`
          : "";
        return `
          <article class="routine-item${done ? " done" : ""}" data-step="${escapeHtml(step.id)}">
            <div class="minute-badge"><span>${escapeHtml(step.minutes)}</span><small>MIN</small></div>
            <div class="routine-copy">
              <h3>${escapeHtml(step.title)}</h3>
              <p>${escapeHtml(step.instruction)}</p>
              ${tab}
            </div>
            <button class="step-check${done ? " done" : ""}" type="button"
              data-step-toggle="${escapeHtml(step.id)}" aria-label="${escapeHtml(step.title)}を完了"
              aria-pressed="${done ? "true" : "false"}">${done ? "✓" : ""}</button>
          </article>`;
      })
      .join("");
  }

  function renderProgress() {
    if (!state.lesson) return;
    const total = state.lesson.routine.length;
    const done = state.completed.size;
    const percent = total ? Math.round((done / total) * 100) : 0;
    setText("completion-label", `${done} / ${total} 完了`);
    setText("progress-value", `${percent}%`);
    const disc = byId("progress-disc");
    if (disc) disc.style.setProperty("--progress", `${percent}%`);
    const completeButton = byId("complete-all");
    if (completeButton) completeButton.textContent = percent === 100 ? "本日の練習は完了です" : "今日の練習を完了";
  }

  function renderLessonList() {
    const list = byId("lesson-list");
    if (!list || !state.index) return;
    list.innerHTML = state.index.lessons
      .map((lesson, index) => `
        <button class="lesson-list-button" type="button" data-lesson-position="${index}">
          <strong>${escapeHtml(lesson.id)}</strong>
          <span><b>${escapeHtml(lesson.title)}</b><br>${escapeHtml(lesson.subtitle)}</span>
          <em>${escapeHtml(lesson.durationMinutes)}分</em>
        </button>`)
      .join("");
  }

  function assetUrl(path) {
    return new URL(`../${String(path).replace(/^\//, "")}`, `${state.dataRoot}/`).href;
  }

  function renderLesson() {
    const lesson = state.lesson;
    if (!lesson) return;
    stopLessonPlayback();

    document.title = `${lesson.id} ${lesson.title}｜指弾きギター練習帖`;
    setText("lesson-number", lesson.id);
    setText("lesson-date", formatDate(lesson.date));
    setText("lesson-level", lesson.levelLabel);
    setText("lesson-duration", `${lesson.durationMinutes} MIN`);
    setText("lesson-title", lesson.title);
    setText("lesson-subtitle", lesson.subtitle);
    setText("lesson-objective", lesson.objective);
    setText("bpm-start", `♩ = ${lesson.bpm.start}`);
    setText("bpm-target", `♩ = ${lesson.bpm.target}`);
    setText("right-hand", lesson.rightHand);
    setText("tuning", lesson.tuning.join(" "));
    setText("tab-title", lesson.score.title);
    setText("tab-rhythm", lesson.score.rhythm);
    setText("right-hand-pattern", lesson.score.rightHandPattern);
    setText("score-tip", lesson.score.tip);
    setText("next-title", lesson.nextStudy.title);
    setText("next-description", lesson.nextStudy.description);

    const tab = byId("main-tab");
    if (tab) tab.textContent = lesson.score.tab.join("\n");

    const checkpoints = byId("checkpoints");
    if (checkpoints) {
      checkpoints.innerHTML = lesson.checkpoints
        .map((item) => `<div class="checkpoint">${escapeHtml(item)}</div>`)
        .join("");
    }

    state.tempo = lesson.bpm.start;
    stopMetronome();
    setText("tempo-value", state.tempo);

    const musicXml = byId("musicxml-link");
    if (musicXml) {
      musicXml.hidden = !lesson.assets?.musicXml;
      musicXml.onclick = () => window.open(assetUrl(lesson.assets.musicXml), "_blank", "noopener,noreferrer");
    }

    const playLesson = byId("play-lesson");
    if (playLesson) {
      playLesson.hidden = !Array.isArray(lesson.score?.playback) || lesson.score.playback.length === 0;
      renderLessonPlaybackButton();
    }

    const previous = byId("previous-lesson");
    const next = byId("next-lesson");
    if (previous) previous.disabled = state.position <= 0;
    if (next) next.disabled = state.position >= state.index.lessons.length - 1;

    readProgress();
    renderRoutine();
    renderProgress();
  }

  async function selectLesson(position) {
    const meta = state.index.lessons[position];
    if (!meta) return;
    try {
      const lesson = await fetchJson(joinUrl(state.dataRoot, meta.path));
      state.position = position;
      state.lesson = lesson;
      renderLesson();
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (error) {
      showLoadError(error);
      throw error;
    }
  }

  function toggleStep(id) {
    if (state.completed.has(id)) state.completed.delete(id);
    else state.completed.add(id);
    saveProgress();
    renderRoutine();
    renderProgress();
  }

  function completeAll() {
    if (!state.lesson) return;
    state.lesson.routine.forEach((step) => state.completed.add(step.id));
    saveProgress();
    renderRoutine();
    renderProgress();
  }

  function resetProgress() {
    state.completed.clear();
    saveProgress();
    renderRoutine();
    renderProgress();
  }

  async function ensureAudio() {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return null;
    if (!state.audioContext) state.audioContext = new AudioContext({ latencyHint: "interactive" });
    if (state.audioContext.state === "suspended") await state.audioContext.resume();
    return state.audioContext;
  }

  function renderLessonPlaybackButton() {
    const button = byId("play-lesson");
    if (!button) return;
    const playing = state.lessonPlaybackSources.size > 0;
    button.textContent = state.lessonPlaybackStarting
      ? "読込中…"
      : playing
        ? "■ お手本停止"
        : "▶ お手本";
    button.disabled = state.lessonPlaybackStarting;
    button.setAttribute("aria-pressed", String(playing));
  }

  function trackLessonPlaybackSource(source, generation) {
    state.lessonPlaybackSources.add(source);
    source.addEventListener("ended", () => {
      if (generation !== state.lessonPlaybackGeneration) return;
      state.lessonPlaybackSources.delete(source);
      if (state.lessonPlaybackSources.size === 0) renderLessonPlaybackButton();
    }, { once: true });
  }

  function stopLessonPlayback() {
    state.lessonPlaybackGeneration += 1;
    state.lessonPlaybackStarting = false;
    for (const source of state.lessonPlaybackSources) {
      try {
        source.stop();
      } catch {
        // Sources that ended between the click and this loop are already silent.
      }
    }
    state.lessonPlaybackSources.clear();
    renderLessonPlaybackButton();
  }

  function scheduleLessonNote(note, time, secondsPerBeat, generation) {
    const context = state.audioContext;
    const string = Number(note.string);
    const midi = OPEN_STRING_MIDI[string] + Number(note.fret);
    const duration = Math.max(0.16, Number(note.beats) * secondsPerBeat * 0.92);
    const pan = (3.5 - string) * 0.055;
    const sampled = state.soundMode === "samples" && state.samplePlayer?.schedule(
      "nylonGuitar",
      {
        time,
        destination: context.destination,
        midi,
        gain: 0.43,
        duration,
        attack: 0.001,
        release: 0.09,
        pan,
      }
    );

    if (sampled) {
      trackLessonPlaybackSource(sampled.source, generation);
      return;
    }

    const oscillator = context.createOscillator();
    const harmonic = context.createOscillator();
    const gain = context.createGain();
    const harmonicGain = context.createGain();
    const frequency = 440 * (2 ** ((midi - 69) / 12));

    oscillator.type = "triangle";
    harmonic.type = "sine";
    oscillator.frequency.setValueAtTime(frequency, time);
    harmonic.frequency.setValueAtTime(frequency * 2, time);
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.exponentialRampToValueAtTime(0.18, time + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + duration);
    harmonicGain.gain.setValueAtTime(0.055, time);
    harmonicGain.gain.exponentialRampToValueAtTime(0.0001, time + Math.min(0.16, duration));

    oscillator.connect(gain);
    harmonic.connect(harmonicGain);
    harmonicGain.connect(gain);
    gain.connect(context.destination);
    trackLessonPlaybackSource(oscillator, generation);
    trackLessonPlaybackSource(harmonic, generation);
    oscillator.start(time);
    harmonic.start(time);
    oscillator.stop(time + duration + 0.01);
    harmonic.stop(time + Math.min(0.17, duration) + 0.01);
  }

  async function toggleLessonPlayback() {
    if (state.lessonPlaybackSources.size > 0) {
      stopLessonPlayback();
      return;
    }
    if (state.lessonPlaybackStarting) return;

    const lesson = state.lesson;
    const notes = lesson?.score?.playback;
    if (!Array.isArray(notes) || notes.length === 0) return;

    stopMetronome();
    const generation = state.lessonPlaybackGeneration + 1;
    state.lessonPlaybackGeneration = generation;
    state.lessonPlaybackStarting = true;
    renderLessonPlaybackButton();
    try {
      const context = await ensureAudio();
      if (!context) return;
      if (state.soundMode === "samples") await prepareRealSamples(["nylonGuitar"]);
      if (generation !== state.lessonPlaybackGeneration || lesson !== state.lesson) return;

      const secondsPerBeat = 60 / state.tempo;
      let nextTime = context.currentTime + 0.06;
      for (const note of notes) {
        scheduleLessonNote(note, nextTime, secondsPerBeat, generation);
        nextTime += Number(note.beats) * secondsPerBeat;
      }
    } finally {
      if (generation === state.lessonPlaybackGeneration) {
        state.lessonPlaybackStarting = false;
        renderLessonPlaybackButton();
      }
    }
  }

  function trackMetronomeSource(source) {
    state.metronomeSources.add(source);
    source.addEventListener("ended", () => state.metronomeSources.delete(source), { once: true });
  }

  function scheduleMetronomePulse(callback, delay) {
    let timer = null;
    timer = window.setTimeout(() => {
      state.metronomePulseTimers.delete(timer);
      callback();
    }, delay);
    state.metronomePulseTimers.add(timer);
  }

  function scheduleClick(time, accent) {
    const context = state.audioContext;
    const sampled = state.soundMode === "samples" && state.samplePlayer?.schedule(
      accent ? "tom" : "closedHat",
      {
        time,
        destination: context.destination,
        gain: accent ? 0.25 : 0.18,
        duration: accent ? 0.18 : 0.09,
      }
    );

    if (sampled) {
      trackMetronomeSource(sampled.source);
    } else {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.frequency.setValueAtTime(accent ? 1320 : 880, time);
      gain.gain.setValueAtTime(0.0001, time);
      gain.gain.exponentialRampToValueAtTime(accent ? 0.2 : 0.13, time + 0.005);
      gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.055);
      oscillator.connect(gain);
      gain.connect(context.destination);
      trackMetronomeSource(oscillator);
      oscillator.start(time);
      oscillator.stop(time + 0.06);
    }

    const button = byId("metronome-toggle");
    if (!button) return;
    scheduleMetronomePulse(() => {
      if (!state.metronomeRunning) return;
      button.classList.add("pulse");
      scheduleMetronomePulse(() => button.classList.remove("pulse"), 90);
    }, Math.max(0, (time - context.currentTime) * 1000));
  }

  async function startMetronome() {
    const button = byId("metronome-toggle");
    if (state.metronomeRunning || state.metronomeStarting) return;
    stopLessonPlayback();
    state.metronomeStarting = true;
    if (button) button.disabled = true;
    try {
      const context = await ensureAudio();
      if (!context) return;
      if (state.soundMode === "samples") await prepareRealSamples();
      stopMetronome();

      state.metronomeRunning = true;
      state.beatInBar = 0;
      state.metronomeScheduler = createScheduler({ context });
      state.metronomeScheduler.start(context.currentTime + 0.06, (time) => {
        scheduleClick(time, state.beatInBar === 0);
        state.beatInBar = (state.beatInBar + 1) % 4;
        // Read tempo at each slot so changes affect the next unscheduled beat.
        return 60 / state.tempo;
      });
      if (button) button.textContent = "STOP";
    } finally {
      state.metronomeStarting = false;
      if (button) button.disabled = false;
    }
  }

  function stopMetronome() {
    state.metronomeRunning = false;
    state.metronomeScheduler?.stop();
    state.metronomeScheduler = null;
    for (const source of state.metronomeSources) {
      try {
        source.stop();
      } catch {
        // A source that ended between the scheduler tick and STOP is already silent.
      }
    }
    state.metronomeSources.clear();
    for (const timer of state.metronomePulseTimers) window.clearTimeout(timer);
    state.metronomePulseTimers.clear();
    const button = byId("metronome-toggle");
    if (button) {
      button.classList.remove("pulse");
      button.textContent = "START";
    }
  }

  function changeTempo(amount) {
    state.tempo = Math.min(160, Math.max(40, state.tempo + amount));
    setText("tempo-value", state.tempo);
  }

  function toggleSoundMode() {
    stopLessonPlayback();
    state.soundMode = state.soundMode === "samples" ? "synth" : "samples";
    saveSoundMode();
    renderSoundMode();
    if (state.soundMode === "samples" && state.audioContext) {
      void prepareRealSamples().catch((error) => {
        console.warn("[audio] sample load failed; using synthesis:", error);
        renderSoundMode("failed");
      });
    }
  }

  function showLoadError(error) {
    const target = byId("routine-list");
    if (!target) return;
    target.innerHTML = `<p class="load-error">教材を読み込めませんでした。通信状態を確認して、ページを再読み込みしてください。<br>${escapeHtml(error.message)}</p>`;
  }

  function bindEvents() {
    document.addEventListener("click", (event) => void handleClick(event).catch(showLoadError));

    async function handleClick(event) {
      const target = event.target.closest("button");
      if (!target) return;

      if (target.dataset.scroll) {
        byId(target.dataset.scroll)?.scrollIntoView({ behavior: "smooth", block: "start" });
      }
      if (target.dataset.stepToggle) toggleStep(target.dataset.stepToggle);
      if (target.dataset.lessonPosition !== undefined) {
        try {
          await selectLesson(Number(target.dataset.lessonPosition));
        } finally {
          byId("lesson-dialog")?.close();
        }
      }
    }

    byId("complete-all")?.addEventListener("click", completeAll);
    byId("reset-progress")?.addEventListener("click", resetProgress);
    byId("previous-lesson")?.addEventListener("click", () => void selectLesson(state.position - 1).catch(() => {}));
    byId("next-lesson")?.addEventListener("click", () => void selectLesson(state.position + 1).catch(() => {}));
    byId("tempo-down")?.addEventListener("click", () => changeTempo(-2));
    byId("tempo-up")?.addEventListener("click", () => changeTempo(2));
    byId("sound-mode-toggle")?.addEventListener("click", toggleSoundMode);
    byId("play-lesson")?.addEventListener("click", () => void toggleLessonPlayback());
    byId("metronome-toggle")?.addEventListener("click", () => {
      if (state.metronomeRunning) stopMetronome();
      else void startMetronome().catch(() => stopMetronome());
    });
    byId("open-lessons")?.addEventListener("click", () => byId("lesson-dialog")?.showModal());
    byId("close-lessons")?.addEventListener("click", () => byId("lesson-dialog")?.close());
  }

  async function bootstrap() {
    bindEvents();
    renderSoundMode();
    try {
      const loaded = await loadIndex();
      state.index = loaded.index;
      state.dataRoot = loaded.root;
      renderLessonList();
      await selectLesson(state.index.lessons.length - 1).catch(() => {});
    } catch (error) {
      showLoadError(error);
    }
  }

  bootstrap();
})();
