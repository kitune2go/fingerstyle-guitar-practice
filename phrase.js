(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const state = {
    data: null,
    phrase: null,
    index: 0,
    noteIndex: 0,
    audio: null,
    running: false,
    loop: false,
    scheduler: null,
    raf: null,
    nextNoteTime: 0,
    scheduledNoteIndex: 0,
    visualQueue: [],
    totalScheduled: 0,
    finishedScheduling: false
  };

  const pitchClass = { C:0, D:2, E:4, F:5, G:7, A:9, B:11 };
  const diatonicLetter = { C:0, D:1, E:2, F:3, G:4, A:5, B:6 };
  const stringLabels = ["e","B","G","D","A","E"];

  function noteParts(name) {
    const match = /^([A-G])([#b]?)(-?\d+)$/.exec(name);
    if (!match) throw new Error("Invalid note: " + name);
    return { letter:match[1], accidental:match[2], octave:Number(match[3]) };
  }

  function noteToMidi(name) {
    const p = noteParts(name);
    const accidental = p.accidental === "#" ? 1 : p.accidental === "b" ? -1 : 0;
    return (p.octave + 1) * 12 + pitchClass[p.letter] + accidental;
  }

  function noteToFrequency(name) {
    return 440 * Math.pow(2, (noteToMidi(name) - 69) / 12);
  }

  function staffY(name) {
    const p = noteParts(name);
    const writtenOctave = p.octave + 1;
    const index = writtenOctave * 7 + diatonicLetter[p.letter];
    const bottomE4 = 4 * 7 + diatonicLetter.E;
    return 110 - (index - bottomE4) * 7;
  }

  async function loadData() {
    const response = await fetch("./data/phrases.json", { cache:"no-store" });
    if (!response.ok) throw new Error("フレーズ教材を読み込めませんでした。");
    state.data = await response.json();
  }

  function buildSelect() {
    $("phrase-select").innerHTML = state.data.phrases
      .map((p, i) => '<option value="' + i + '">' + (i + 1) + ". " + p.title + "</option>")
      .join("");
  }

  function totalBeats(phrase = state.phrase) {
    return phrase.notes.reduce((sum, n) => sum + Number(n.beats || 1), 0);
  }

  function buildTab() {
    const lines = stringLabels.map((label, idx) => {
      const stringNo = idx + 1;
      let line = label + "|";
      for (const note of state.phrase.notes) {
        const cell = note.string === stringNo ? ("-" + note.fret).padEnd(4, "-") : "----";
        line += cell;
      }
      return line + "|";
    });
    $("tab").textContent = lines.join("\n");
  }

  function buildStaff() {
    const svg = $("staff");
    const ns = "http://www.w3.org/2000/svg";
    svg.innerHTML = "";

    const add = (name, attrs, text) => {
      const el = document.createElementNS(ns, name);
      for (const [key, value] of Object.entries(attrs || {})) el.setAttribute(key, String(value));
      if (text !== undefined) el.textContent = text;
      svg.appendChild(el);
      return el;
    };

    [54,68,82,96,110].forEach(y => add("line",{x1:58,y1:y,x2:900,y2:y,class:"staff-line"}));
    add("text",{x:14,y:103,class:"clef"},"𝄞");
    add("text",{x:50,y:75,class:"time-sig"},"4");
    add("text",{x:50,y:99,class:"time-sig"},"4");

    const total = totalBeats();
    const startX = 92;
    const endX = 884;
    let beatCursor = 0;

    state.phrase.notes.forEach((note, index) => {
      const x = startX + (beatCursor / Math.max(total, 1)) * (endX - startX);
      const y = staffY(note.name);
      const beats = Number(note.beats || 1);

      if (y > 110) {
        for (let ly = 124; ly <= y + 1; ly += 14) add("line",{x1:x-10,y1:ly,x2:x+10,y2:ly,class:"ledger"});
      }
      if (y < 54) {
        for (let ly = 40; ly >= y - 1; ly -= 14) add("line",{x1:x-10,y1:ly,x2:x+10,y2:ly,class:"ledger"});
      }

      const head = add("ellipse",{
        cx:x,cy:y,rx:7,ry:5,class:"note-head","data-note-index":index,
        transform:"rotate(-18 " + x + " " + y + ")"
      });
      head.addEventListener("click", () => {
        state.noteIndex = index;
        renderCurrentNote();
        highlightNote(index);
      });

      if (beats < 4) {
        add("line",{x1:x+6,y1:y,x2:x+6,y2:y-30,class:"note-stem","data-stem-index":index});
        if (beats <= 0.5) {
          add("path",{d:"M " + (x+6) + " " + (y-30) + " q 16 8 4 19",fill:"none",stroke:"#202522","stroke-width":"2"});
        }
      }

      add("text",{x:x-4,y:145,class:"finger-text"},note.finger || "");
      beatCursor += beats;

      if (Math.abs(beatCursor % 4) < 0.001 || index === state.phrase.notes.length - 1) {
        const bx = startX + (beatCursor / Math.max(total,1)) * (endX - startX);
        add("line",{x1:bx,y1:54,x2:bx,y2:110,class:"bar-line"});
      }
    });
  }

  function renderPhrase() {
    stop();
    state.phrase = state.data.phrases[state.index];
    state.noteIndex = 0;
    $("phrase-select").value = String(state.index);
    $("phrase-title").textContent = state.phrase.title;
    $("phrase-subtitle").textContent = state.phrase.subtitle;
    $("phrase-objective").textContent = state.phrase.objective;
    $("tempo").value = state.phrase.bpm;
    $("tempo-label").textContent = state.phrase.bpm;
    $("right-hand").textContent = state.phrase.rightHand;
    buildStaff();
    buildTab();
    renderCurrentNote();
    highlightNote(0);
    updateProgress(0);
  }

  function renderCurrentNote() {
    const note = state.phrase.notes[state.noteIndex];
    $("note-name").textContent = note.name;
    $("note-position").textContent = note.string + "弦 " + note.fret + "フレット";
    $("note-finger").textContent = "右手 " + (note.finger || "—");
    $("position-label").textContent = (state.noteIndex + 1) + " / " + state.phrase.notes.length;
  }

  function highlightNote(index) {
    document.querySelectorAll(".note-head").forEach(el =>
      el.classList.toggle("active", Number(el.dataset.noteIndex) === index)
    );
    document.querySelectorAll("[data-stem-index]").forEach(el =>
      el.classList.toggle("active", Number(el.dataset.stemIndex) === index)
    );
  }

  function updateProgress(value) {
    $("progress-bar").style.width = Math.max(0, Math.min(100, value)) + "%";
  }

  async function ensureAudio() {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) throw new Error("このブラウザはWeb Audioに対応していません。");
    if (!state.audio) state.audio = new AudioContext({ latencyHint:"interactive" });
    if (state.audio.state === "suspended") await state.audio.resume();
  }

  function schedulePluck(note, time, durationSec) {
    const freq = noteToFrequency(note.name);
    const master = state.audio.createGain();
    master.gain.setValueAtTime(0.0001, time);
    master.gain.exponentialRampToValueAtTime(0.24, time + 0.006);
    master.gain.exponentialRampToValueAtTime(0.0001, time + Math.max(0.16, Math.min(1.4, durationSec * 0.9 + 0.18)));
    master.connect(state.audio.destination);

    const fundamental = state.audio.createOscillator();
    fundamental.type = "triangle";
    fundamental.frequency.setValueAtTime(freq, time);
    const harmonic = state.audio.createOscillator();
    harmonic.type = "sine";
    harmonic.frequency.setValueAtTime(freq * 2, time);

    const harmonicGain = state.audio.createGain();
    harmonicGain.gain.setValueAtTime(0.12, time);
    harmonicGain.gain.exponentialRampToValueAtTime(0.0001, time + 0.18);

    fundamental.connect(master);
    harmonic.connect(harmonicGain);
    harmonicGain.connect(master);
    fundamental.start(time);
    harmonic.start(time);
    fundamental.stop(time + Math.max(0.2, durationSec + 0.3));
    harmonic.stop(time + 0.22);
  }

  function secondsFor(note) {
    const bpm = Number($("tempo").value);
    return Number(note.beats || 1) * 60 / bpm;
  }

  function schedulerTick() {
    if (!state.running || !state.audio) return;
    const ahead = state.audio.currentTime + 0.12;

    while (!state.finishedScheduling && state.nextNoteTime < ahead) {
      const note = state.phrase.notes[state.scheduledNoteIndex];
      const duration = secondsFor(note);
      schedulePluck(note, state.nextNoteTime, duration);
      state.visualQueue.push({
        time: state.nextNoteTime,
        index: state.scheduledNoteIndex,
        ordinal: state.totalScheduled
      });
      state.nextNoteTime += duration;
      state.totalScheduled += 1;
      state.scheduledNoteIndex += 1;

      if (state.scheduledNoteIndex >= state.phrase.notes.length) {
        if (state.loop) {
          state.scheduledNoteIndex = 0;
        } else {
          state.finishedScheduling = true;
        }
      }
    }
  }

  function visualLoop() {
    if (!state.running || !state.audio) return;
    const now = state.audio.currentTime;

    while (state.visualQueue.length && state.visualQueue[0].time <= now) {
      const event = state.visualQueue.shift();
      state.noteIndex = event.index;
      renderCurrentNote();
      highlightNote(event.index);
      const cyclePos = event.index / Math.max(1, state.phrase.notes.length);
      updateProgress(cyclePos * 100);
    }

    if (state.finishedScheduling && state.visualQueue.length === 0 && now > state.nextNoteTime) {
      updateProgress(100);
      stop(false);
      return;
    }

    state.raf = requestAnimationFrame(visualLoop);
  }

  async function play() {
    if (state.running) return;
    await ensureAudio();
    state.running = true;
    state.scheduledNoteIndex = 0;
    state.nextNoteTime = state.audio.currentTime + 0.08;
    state.visualQueue.length = 0;
    state.totalScheduled = 0;
    state.finishedScheduling = false;
    $("play").disabled = true;
    $("stop").disabled = false;
    schedulerTick();
    state.scheduler = setInterval(schedulerTick, 25);
    state.raf = requestAnimationFrame(visualLoop);
  }

  function stop(resetProgress = true) {
    state.running = false;
    if (state.scheduler) clearInterval(state.scheduler);
    if (state.raf) cancelAnimationFrame(state.raf);
    state.scheduler = null;
    state.raf = null;
    state.visualQueue.length = 0;
    state.finishedScheduling = false;
    $("play").disabled = false;
    $("stop").disabled = true;
    if (resetProgress) updateProgress(0);
  }

  async function playOne() {
    await ensureAudio();
    const note = state.phrase.notes[state.noteIndex];
    schedulePluck(note, state.audio.currentTime + 0.02, secondsFor(note));
    highlightNote(state.noteIndex);
  }

  function moveNote(amount) {
    const length = state.phrase.notes.length;
    state.noteIndex = (state.noteIndex + amount + length) % length;
    renderCurrentNote();
    highlightNote(state.noteIndex);
    updateProgress((state.noteIndex / Math.max(1, length - 1)) * 100);
  }

  async function bootstrap() {
    try {
      await loadData();
      buildSelect();
      renderPhrase();
      $("phrase-select").addEventListener("change", (e) => {
        state.index = Number(e.target.value);
        renderPhrase();
      });
      $("tempo").addEventListener("input", (e) => $("tempo-label").textContent = e.target.value);
      $("play").addEventListener("click", () => play().catch(alert));
      $("stop").addEventListener("click", () => stop());
      $("loop").addEventListener("click", () => {
        state.loop = !state.loop;
        $("loop").setAttribute("aria-pressed", String(state.loop));
        $("loop").textContent = state.loop ? "↻ ループON" : "↻ ループOFF";
      });
      $("play-note").addEventListener("click", () => playOne().catch(alert));
      $("previous-note").addEventListener("click", () => moveNote(-1));
      $("next-note").addEventListener("click", () => moveNote(1));

      if ("serviceWorker" in navigator) {
        window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js").catch(() => {}));
      }
    } catch (error) {
      document.body.insertAdjacentHTML("beforeend", '<p style="padding:16px;color:#9e3f2f">' + error.message + "</p>");
    }
  }

  bootstrap();
})();
