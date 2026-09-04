import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = process.env.LESSON_ROOT
  ? path.resolve(process.env.LESSON_ROOT)
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const errors = [];

async function readJson(relativePath) {
  try {
    return JSON.parse(await fs.readFile(path.join(root, relativePath), "utf8"));
  } catch (error) {
    errors.push(`${relativePath}: 読み込みまたはJSON解析に失敗しました（${error.message}）`);
    return null;
  }
}

function requireText(value, location) {
  if (typeof value !== "string" || value.trim() === "") errors.push(`${location}: 空でない文字列が必要です`);
}

function validateTab(tab, location) {
  if (!Array.isArray(tab) || tab.length < 6) {
    errors.push(`${location}: 6弦分以上のTAB配列が必要です`);
    return;
  }
  const guitarLines = tab.filter((line) => /^[eBGDAE]\|/.test(String(line)));
  const labels = guitarLines.map((line) => String(line)[0]).join("");
  if (labels !== "eBGDAE") errors.push(`${location}: TABの弦順は上から e / B / G / D / A / E にしてください（実際: ${labels || "なし"}）`);
}

function validatePlayback(playback, location) {
  if (!Array.isArray(playback) || playback.length === 0) {
    errors.push(`${location}: 1音以上のお手本再生データが必要です`);
    return;
  }

  for (const [index, note] of playback.entries()) {
    const noteLocation = `${location}[${index}]`;
    if (!Number.isInteger(note?.string) || note.string < 1 || note.string > 6) {
      errors.push(`${noteLocation}.string: 1〜6の整数が必要です`);
    }
    if (!Number.isInteger(note?.fret) || note.fret < 0 || note.fret > 24) {
      errors.push(`${noteLocation}.fret: 0〜24の整数が必要です`);
    }
    if (![0.5, 1, 2, 4].includes(note?.beats)) {
      errors.push(`${noteLocation}.beats: 0.5 / 1 / 2 / 4 のいずれかが必要です`);
    }
  }
}

const index = await readJson("data/lessons-index.json");
if (!index || index.schemaVersion !== 1 || !Array.isArray(index.lessons) || index.lessons.length === 0) {
  errors.push("data/lessons-index.json: schemaVersion 1 と空でない lessons 配列が必要です");
}

const seenIds = new Set();
const seenPaths = new Set();

if (Array.isArray(index?.lessons)) {
  for (let position = 0; position < index.lessons.length; position += 1) {
    const meta = index.lessons[position];
    const expectedId = String(position + 1).padStart(3, "0");
    if (meta.id !== expectedId) errors.push(`lessons[${position}].id: ${expectedId} が必要です（実際: ${meta.id}）`);
    if (seenIds.has(meta.id)) errors.push(`lessons[${position}].id: 重複しています（${meta.id}）`);
    if (seenPaths.has(meta.path)) errors.push(`lessons[${position}].path: 重複しています（${meta.path}）`);
    seenIds.add(meta.id);
    seenPaths.add(meta.path);

    const lesson = await readJson(`data/${meta.path}`);
    if (!lesson) continue;

    if (lesson.id !== meta.id) errors.push(`data/${meta.path}: idが索引と一致しません`);
    if (lesson.title !== meta.title) errors.push(`data/${meta.path}: titleが索引と一致しません`);
    if (lesson.date !== meta.date) errors.push(`data/${meta.path}: dateが索引と一致しません`);
    if (lesson.durationMinutes !== meta.durationMinutes) errors.push(`data/${meta.path}: durationMinutesが索引と一致しません`);

    ["title", "subtitle", "levelLabel", "objective", "rightHand"].forEach((key) => requireText(lesson[key], `data/${meta.path}.${key}`));
    if (!Number.isInteger(lesson.bpm?.start) || !Number.isInteger(lesson.bpm?.target)) errors.push(`data/${meta.path}.bpm: startとtargetには整数が必要です`);
    if (!Array.isArray(lesson.tuning) || lesson.tuning.join("") !== "EADGBE") errors.push(`data/${meta.path}.tuning: 標準チューニング E A D G B E が必要です`);

    validateTab(lesson.score?.tab, `data/${meta.path}.score.tab`);
    validatePlayback(lesson.score?.playback, `data/${meta.path}.score.playback`);
    if (!Array.isArray(lesson.routine) || lesson.routine.length < 3) errors.push(`data/${meta.path}.routine: 3項目以上が必要です`);

    const minuteTotal = Array.isArray(lesson.routine)
      ? lesson.routine.reduce((total, step) => total + Number(step.minutes || 0), 0)
      : 0;
    if (minuteTotal !== lesson.durationMinutes) errors.push(`data/${meta.path}.routine: 分数合計${minuteTotal}がdurationMinutes ${lesson.durationMinutes}と一致しません`);

    const stepIds = new Set();
    for (const [stepIndex, step] of (lesson.routine || []).entries()) {
      requireText(step.id, `data/${meta.path}.routine[${stepIndex}].id`);
      requireText(step.title, `data/${meta.path}.routine[${stepIndex}].title`);
      requireText(step.instruction, `data/${meta.path}.routine[${stepIndex}].instruction`);
      if (stepIds.has(step.id)) errors.push(`data/${meta.path}.routine[${stepIndex}].id: 重複しています`);
      stepIds.add(step.id);
    }

    if (!Array.isArray(lesson.checkpoints) || lesson.checkpoints.length < 3) errors.push(`data/${meta.path}.checkpoints: 3項目以上が必要です`);
    requireText(lesson.nextStudy?.title, `data/${meta.path}.nextStudy.title`);
    requireText(lesson.nextStudy?.description, `data/${meta.path}.nextStudy.description`);

    if (lesson.assets?.musicXml) {
      try {
        await fs.access(path.join(root, lesson.assets.musicXml));
      } catch {
        errors.push(`${lesson.assets.musicXml}: MusicXMLファイルが存在しません`);
      }
    }
  }
}

if (errors.length) {
  console.error(`教材検証に失敗しました:\n\n${errors.map((error) => `- ${error}`).join("\n")}`);
  process.exit(1);
}

console.log(`教材検証成功: ${index.lessons.length}課 / ID ${index.lessons[0].id}〜${index.lessons.at(-1).id}`);
