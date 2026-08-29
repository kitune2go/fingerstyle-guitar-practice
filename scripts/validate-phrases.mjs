import fs from "node:fs";

const file = new URL("../data/phrases.json", import.meta.url);
const data = JSON.parse(fs.readFileSync(file, "utf8"));

if (data.schemaVersion !== 1) throw new Error("phrases schemaVersion must be 1");
if (!Array.isArray(data.phrases) || data.phrases.length === 0) throw new Error("phrases must not be empty");

const seen = new Set();
const notePattern = /^[A-G][#b]?-?\d+$/;

for (const phrase of data.phrases) {
  if (!phrase.id || seen.has(phrase.id)) throw new Error("phrase id must be unique");
  seen.add(phrase.id);
  if (!phrase.title || !phrase.objective) throw new Error(phrase.id + ": title/objective required");
  if (!Number.isFinite(phrase.bpm) || phrase.bpm < 40 || phrase.bpm > 200) throw new Error(phrase.id + ": bpm out of range");
  if (!Array.isArray(phrase.notes) || phrase.notes.length === 0) throw new Error(phrase.id + ": notes required");

  phrase.notes.forEach((note, index) => {
    if (!notePattern.test(note.name)) throw new Error(phrase.id + ": invalid note at " + index);
    if (!Number.isInteger(note.string) || note.string < 1 || note.string > 6) throw new Error(phrase.id + ": invalid string at " + index);
    if (!Number.isInteger(note.fret) || note.fret < 0 || note.fret > 24) throw new Error(phrase.id + ": invalid fret at " + index);
    if (!Number.isFinite(note.beats) || note.beats <= 0) throw new Error(phrase.id + ": invalid beats at " + index);
    if (!["p","i","m","a"].includes(note.finger)) throw new Error(phrase.id + ": invalid right-hand finger at " + index);
  });
}

console.log("Validated " + data.phrases.length + " playable phrases.");
