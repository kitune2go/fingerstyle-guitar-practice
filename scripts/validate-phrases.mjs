import fs from "node:fs";

const file = new URL("../data/phrases.json", import.meta.url);
const data = JSON.parse(fs.readFileSync(file, "utf8"));

if (data.schemaVersion !== 1) throw new Error("phrases schemaVersion must be 1");
if (!Array.isArray(data.phrases) || data.phrases.length === 0) throw new Error("phrases must not be empty");

const seen = new Set();
const notePattern = /^([A-G])([#b]?)(-?\d+)$/;
const pitchClass = { C:0, D:2, E:4, F:5, G:7, A:9, B:11 };
const openMidi = { 1:64, 2:59, 3:55, 4:50, 5:45, 6:40 };

function noteToMidi(name) {
  const match = notePattern.exec(name);
  if (!match) return null;
  const accidental = match[2] === "#" ? 1 : match[2] === "b" ? -1 : 0;
  return (Number(match[3]) + 1) * 12 + pitchClass[match[1]] + accidental;
}

for (const phrase of data.phrases) {
  if (!phrase.id || seen.has(phrase.id)) throw new Error("phrase id must be unique");
  seen.add(phrase.id);
  if (!phrase.title || !phrase.objective) throw new Error(phrase.id + ": title/objective required");
  if (!Number.isFinite(phrase.bpm) || phrase.bpm < 40 || phrase.bpm > 200) throw new Error(phrase.id + ": bpm out of range");
  if (!Array.isArray(phrase.notes) || phrase.notes.length === 0) throw new Error(phrase.id + ": notes required");

  const fingers = String(phrase.rightHand || "").trim().split(/\s+/).filter(Boolean);
  if (fingers.length !== phrase.notes.length) throw new Error(phrase.id + ": rightHand count must match notes");

  let totalBeats = 0;
  phrase.notes.forEach((note, index) => {
    const midi = noteToMidi(note.name);
    if (midi === null) throw new Error(phrase.id + ": invalid note at " + index);
    if (!Number.isInteger(note.string) || note.string < 1 || note.string > 6) throw new Error(phrase.id + ": invalid string at " + index);
    if (!Number.isInteger(note.fret) || note.fret < 0 || note.fret > 24) throw new Error(phrase.id + ": invalid fret at " + index);
    if (!Number.isFinite(note.beats) || note.beats <= 0) throw new Error(phrase.id + ": invalid beats at " + index);
    if (!["p","i","m","a"].includes(note.finger)) throw new Error(phrase.id + ": invalid right-hand finger at " + index);

    const tabMidi = openMidi[note.string] + note.fret;
    if (midi !== tabMidi) {
      throw new Error(phrase.id + ": pitch/TAB mismatch at note " + index + " (" + note.name + ")");
    }
    if (fingers[index] !== note.finger) {
      throw new Error(phrase.id + ": rightHand sequence mismatch at note " + index);
    }
    totalBeats += note.beats;
  });

  if (Math.abs(totalBeats % 4) > 1e-9) {
    throw new Error(phrase.id + ": total beats must fill complete 4/4 bars");
  }
}

console.log("Validated " + data.phrases.length + " playable phrases with pitch/TAB consistency.");
