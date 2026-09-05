import fs from "node:fs";
import { validatePhraseData } from "./phrase-schema.mjs";

const file=new URL("../data/phrases.json",import.meta.url);
const data=JSON.parse(fs.readFileSync(file,"utf8"));

validatePhraseData(data);
console.log("フレーズ検証成功: "+data.phrases.length+"件 / 記譜音価・連符・奏法・音名/TAB整合性");
