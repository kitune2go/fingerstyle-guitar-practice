(() => {
  "use strict";

  const app = document.getElementById("practice-app");
  if (!app) return;

  const byId = (id) => document.getElementById(id);
  const source = (app.dataset.source || "./data").replace(/\/$/, "");
  const localFallback = new URL("/data/", window.location.origin).href.replace(/\/$/, "");

  const state = {
    index: null,
    dataRoot: source,
    position: 0,
    lesson: null,
    completed: new Set(),
    tempo: 60,
    metronomeTimer: null,
    audioContext: null,
  };

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
    localStorage.setItem(progressKey(), JSON.stringify([...state.completed]));
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
    return joinUrl(state.dataRoot, `../${path}`);
  }

  function renderLesson() {
    const lesson = state.lesson;
    if (!lesson) return;

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
    const lesson = await fetchJson(joinUrl(state.dataRoot, meta.path));
    state.position = position;
    state.lesson = lesson;
    renderLesson();
    window.scrollTo({ top: 0, behavior: "smooth" });
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

  async function clickBeat() {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    if (!state.audioContext) state.audioContext = new AudioContext();
    if (state.audioContext.state === "suspended") await state.audioContext.resume();

    const now = state.audioContext.currentTime;
    const oscillator = state.audioContext.createOscillator();
    const gain = state.audioContext.createGain();
    oscillator.frequency.setValueAtTime(880, now);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.16, now + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.055);
    oscillator.connect(gain);
    gain.connect(state.audioContext.destination);
    oscillator.start(now);
    oscillator.stop(now + 0.06);

    const button = byId("metronome-toggle");
    button?.classList.add("pulse");
    window.setTimeout(() => button?.classList.remove("pulse"), 90);
  }

  function startMetronome() {
    stopMetronome();
    clickBeat();
    state.metronomeTimer = window.setInterval(clickBeat, 60000 / state.tempo);
    const button = byId("metronome-toggle");
    if (button) button.textContent = "STOP";
  }

  function stopMetronome() {
    if (state.metronomeTimer) window.clearInterval(state.metronomeTimer);
    state.metronomeTimer = null;
    const button = byId("metronome-toggle");
    if (button) button.textContent = "START";
  }

  function changeTempo(amount) {
    state.tempo = Math.min(160, Math.max(40, state.tempo + amount));
    setText("tempo-value", state.tempo);
    if (state.metronomeTimer) startMetronome();
  }

  function showLoadError(error) {
    const target = byId("routine-list");
    if (!target) return;
    target.innerHTML = `<p class="load-error">教材を読み込めませんでした。通信状態を確認して、ページを再読み込みしてください。<br>${escapeHtml(error.message)}</p>`;
  }

  function bindEvents() {
    document.addEventListener("click", async (event) => {
      const target = event.target.closest("button");
      if (!target) return;

      if (target.dataset.scroll) {
        byId(target.dataset.scroll)?.scrollIntoView({ behavior: "smooth", block: "start" });
      }
      if (target.dataset.stepToggle) toggleStep(target.dataset.stepToggle);
      if (target.dataset.lessonPosition !== undefined) {
        await selectLesson(Number(target.dataset.lessonPosition));
        byId("lesson-dialog")?.close();
      }
    });

    byId("complete-all")?.addEventListener("click", completeAll);
    byId("reset-progress")?.addEventListener("click", resetProgress);
    byId("previous-lesson")?.addEventListener("click", () => selectLesson(state.position - 1));
    byId("next-lesson")?.addEventListener("click", () => selectLesson(state.position + 1));
    byId("tempo-down")?.addEventListener("click", () => changeTempo(-2));
    byId("tempo-up")?.addEventListener("click", () => changeTempo(2));
    byId("metronome-toggle")?.addEventListener("click", () => {
      if (state.metronomeTimer) stopMetronome();
      else startMetronome();
    });
    byId("open-lessons")?.addEventListener("click", () => byId("lesson-dialog")?.showModal());
    byId("close-lessons")?.addEventListener("click", () => byId("lesson-dialog")?.close());
  }

  async function bootstrap() {
    bindEvents();
    try {
      const loaded = await loadIndex();
      state.index = loaded.index;
      state.dataRoot = loaded.root;
      renderLessonList();
      await selectLesson(state.index.lessons.length - 1);
    } catch (error) {
      showLoadError(error);
    }

    if ("serviceWorker" in navigator) {
      window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js").catch(() => {}));
    }
  }

  bootstrap();
})();
