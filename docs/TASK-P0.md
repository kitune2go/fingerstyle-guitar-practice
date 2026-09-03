# 実装依頼 P0 — エンジン層の抽出

このタスクの仕様書です。実装者（人間・AIを問わず）はこの文書に従ってください。

**先に [`AGENTS.md`](../AGENTS.md) を読んでください。** リポジトリ共通の規約・検証手順・既知の制約が
そちらにあり、この文書はそれを前提にしています。

- 対象リポジトリ: `kitune2go/fingerstyle-guitar-practice`
- 作業ブランチ: `main` から `feat/core-extraction` を切る
- 背景と全体像: [`docs/ARCHITECTURE.md`](ARCHITECTURE.md)

## 0. このタスクの目的

現在 `phrase.js`（829行）は、データ取得・音楽モデル・SVG製譜・音源合成・スケジューリング・UIを1ファイルで抱えています。
`guitar.js` は先読みスケジューラを別実装で重複して持っています。

**今後ドリルが増えるたびに製譜器とスケジューラを書き直すことになるため、先に切り出します。**

これは**リファクタリングであり、機能追加ではありません。**
画面の見た目・音・DOM構造は1ピクセル、1バイトも変えないでください。

---

## 1. 絶対的な不変条件

以下に1つでも違反したら、その実装は不合格です。

1. **既存の13件のPlaywrightテストが、テストコードを1文字も変更せずに全て通ること。**
   テストが落ちたらテストを直すのではなく、実装を直してください。
2. `npm test`（データ検証）が通ること。
3. `data/**` のJSONファイルとそのスキーマを変更しないこと。
4. **描画されるDOMの構造・クラス名・属性を変更しないこと。** テストが依存している契約です:
   - 要素: `.staff-system` `.staff-line` `.bar-line` `.ledger` `.note-symbol` `.note-head` `.note-head.open`
     `.note-stem` `.note-flag` `.note-name-text` `.finger-text` `.accidental` `.key-signature`
     `.clef` `.time-sig` `.measure-no` `.chord-symbol`
   - 属性: `data-measure` `data-staff-line` `data-note-index` `data-note-name` `role="button"` `tabindex="0"`
   - 1小節 = 1つの `<svg class="staff-system">`。調号は全システムに描画される。
5. **音の出力を変えないこと。** オシレータの種類・周波数・エンベロープの数値・接続順は現状のまま移設。
6. `rhythm.html` には一切触らないこと。

---

## 2. スコープ

### 新規作成

```
core/music.js
core/clock.js
core/notation.js
tests/unit/music.test.mjs
```

### 変更

```
phrase.js       core/ を使うように書き換え
guitar.js       スケジューラを core/clock.js に置き換え
index.html      script タグを module 化
phrase.html     script タグを module 化
sw.js           APP_SHELL に core/*.js を追加、CACHE_NAME を v10 へ
package.json    test スクリプトに単体テストを追加
scripts/validate-phrases.mjs  重複ロジックを core/music.js の import に置き換え
.github/workflows/validate.yml  node --check の対象に core/*.js を追加
```

### 触ってはいけない

```
rhythm.html   data/**   musicxml/**   tests/smoke.spec.mjs
guitar.css    phrase.css   register-sw.js   playwright.config.mjs
```

### 今回やらないこと（意図的な判断）

`docs/ARCHITECTURE.md` には `core/synth.js`（音源）も挙がっていますが、**P0には含めません。**
`phrase.js` の `buildMixer` / `scheduleMelody` / `scheduleChord` / `scheduleBass` / `scheduleKick` /
`scheduleNoise` / `envelopeGain` / `createBus` は、**現在の場所に置いたままにしてください。**

理由: 音源の抽出は「どこまでをドリル共通の音源とするか」の設計判断を伴い、P1でマイク入力と
一緒に決めるほうが手戻りが少ないためです。1回の依頼で3モジュールは既に十分な分量です。

---

## 3. 成果物1 — `core/music.js`

### `core/` 全体の境界（3モジュールで異なります）

**「`core/` はDOMを触らない」ではありません。** 共通する不変条件は
**グローバル環境（`document` / `window` / `AudioContext`）を直接参照しないこと**です。
必要なものは全て引数で受け取ります。境界はモジュールごとに違います。

| モジュール | 境界 |
|---|---|
| `music.js` | 完全にプラットフォーム非依存の純ロジック。DOMもWeb Audioも使わない。Nodeから直接テストできる |
| `clock.js` | `AudioContext` を**引数で受け取る**。グローバルの `AudioContext` / `window` は参照しない |
| `notation.js` | **DOMアダプタ。DOMは作ります。** ただしページ固有のUI（`.chord-chip`、スクロール制御、アプリの状態）は知らない。グローバルの `document` を参照せず、引数の `host.ownerDocument` 経由でのみ要素を生成する |

`notation.js` がDOMを作るのは設計違反ではありません。**画面から独立していること**が要件であり、
DOMに触れないことが要件ではありません。

### `core/music.js`

**DOMにもWeb Audioにも触れない純関数のみ。** ブラウザとNodeの両方から `import` できること。
これは努力目標ではなく受け入れ条件です（§7の単体テストとバリデータがNodeから読み込みます）。

現在 `phrase.js` に散在している音楽ロジックを、**ロジックを変えずに**移設します。

### エクスポートする定数

```js
export const STRING_LABELS = ["e","B","G","D","A","E"];   // 1弦→6弦の順
export const OPEN_MIDI = { 1:64, 2:59, 3:55, 4:50, 5:45, 6:40 };
export const STAFF_LINES = [66,78,90,102,114];
export const MIDDLE_LINE_Y = 90;
export const STEM_LENGTH = 35;
export const SUPPORTED_KEYS;   // Set<string>。現在の keyFifths のキー集合
```

### エクスポートする関数

現行 `phrase.js` から移設（実装は現状のまま、`state` 参照だけを引数に置き換える）:

```js
noteParts(name)            // → { letter, accidental, octave }
noteToMidi(name)           // → number
midiToFrequency(midi)      // → number
noteToFrequency(name)      // → number
staffY(name)               // → number  ※ギターは記譜より1オクターブ低く鳴る前提を維持
alterationOf(name)         // → -1 | 0 | 1
keySignature(key)          // → { glyphs: [{letter,y,glyph}], alterByLetter }
chordInfo(name)            // → { root, intervals }
tabCellWidth(note)         // → number
```

`state` を読んでいた関数は**純関数化**します。引数と戻り値を以下に固定してください。

```js
splitMeasures(notes)
// → measures: Array<Array<note & { globalIndex, startBeat }>>
// 元の note オブジェクトは変更しない（現行どおりスプレッドでコピー）

annotateAccidentals(measures, key)
// → { measures, signature }
// measures 内の各 note に accidentalGlyph（"♯"|"♭"|"♮"|null）を付与
// 小節ごとに臨時記号の効果をリセットする現行ロジックをそのまま維持

computeLayout(notes)
// → { top, height, nameY, fingerY }

noteStartsByGrid(notes)
// → Map<gridIndex, Array<{ note, index }>>   ※ grid は8分音符単位

measureForNote(measures, index)
// → number

buildTabText(measures, chords)
// → string   現行 buildTab() の文字列生成部分のみ。DOM書き込みは呼び出し側に残す
```

### 統合エントリポイント

```js
buildPhraseModel(phrase)
// → { notes, measures, signature, layout, noteStarts, tabText }
```

内部で `splitMeasures` → `annotateAccidentals` → `computeLayout` → `noteStartsByGrid` → `buildTabText`
をこの順に呼ぶだけの薄いラッパーにしてください。
**P1のドリル実行画面は、DOMを一切作らずにこれを呼びます。** そのため副作用を持たせないこと。

---

## 4. 成果物2 — `core/clock.js`

`phrase.js` の `schedulerTick` と `guitar.js` の `metronomeTick` は、同じ「先読みスケジューラ」の別実装です。
1つにまとめます。

```js
export function createScheduler({ context, lookahead = 0.15, tickMs = 25 })
// → { start(firstTime, onSlot), stop(), get running() }
```

- `start(firstTime, onSlot)` — `firstTime` は最初のスロットの `AudioContext` 時刻。
- `onSlot(time)` — スロット1つ分の音を予約するコールバック。
  **戻り値は「次のスロットまでの秒数」**、または `null`（これ以上スロットを進めない）。
- `stop()` — 内部の `setInterval` を解除。**音の停止やUI更新は行わない**（呼び出し側の責務）。
- `start()` は即座に1回スケジュールしてから `setInterval` を開始すること（現行の挙動）。

**呼び出し側がスロット番号を持ちます。** `phrase.js` はループ時に grid を0へ戻すため、
スケジューラ側の単調増加カウンタでは表現できません。`onSlot` に渡すのは時刻のみです。

### 移行の対応関係

| | phrase.js | guitar.js |
|---|---|---|
| `onSlot(time)` の中身 | `scheduleGrid(state.nextGrid, time)` → grid を進める → ループ/終了判定 | `scheduleClick(time, state.beatInBar===0)` → `beatInBar` を進める |
| 戻り値 | `secondsPerBeat()/2`、終了時は `null` | `60 / state.tempo` |

**テンポは毎スロット読み直す現行の挙動を維持してください。** 再生中・メトロノーム動作中のテンポ変更が
次のスロットから反映される性質は、意図的な仕様です。

> **仕様変更を1点だけ許可します。** `phrase.js` の先読みは現在 `0.16` 秒、`guitar.js` は `0.15` 秒です。
> `0.15` に統一してください。これは意図的な変更で、テストには影響しません。

---

## 5. 成果物3 — `core/notation.js`

`svgEl` / `addLedgerLines` / `addNoteSymbol` / `buildStaff` を移設します。

```js
export function renderScore(host, model, { chords, onSelectNote })
// host: 描画先の要素（中身を空にしてから描く）
// model: music.buildPhraseModel() の戻り値
// onSelectNote(index): 音符がクリック/Enter/Space された時に呼ぶ

export function setActiveNote(host, index)   // 現行 highlightNote 相当
export function systemElement(host, measureIndex)  // 追従スクロール用に <svg> を返す
```

**重要 — 依存の向きを逆転させること。**
現在の `addNoteSymbol` はクリックハンドラ内から `renderCurrentNote()` や `highlightNote()` を直接呼んでいます。
`core/` は画面を知ってはいけないので、`onSelectNote(index)` を呼ぶだけにし、
画面側（`phrase.js`）がその中で `renderCurrentNote` / `setActiveNote` / `highlightMeasure` / `followScore` を行います。

要素の生成には `host.ownerDocument.createElementNS(...)` を使い、グローバルの `document` は参照しないでください。
DOMを作ること自体は、このモジュールの役割です。

`highlightMeasure`（コード進行チップの強調）と `followScore`（自動追従）は
`.chord-chip` やスクロール制御という画面固有の関心なので、**`phrase.js` に残します。**

---

## 6. ESモジュール化に伴う波及 — 見落としやすい箇所

`import` を使う以上、読み込み方が変わります。以下を**必ず**行ってください。
**どのコミットで行うかは §12 を見てください**（順序を間違えると途中のコミットが壊れます）。

1. **HTML のスクリプトタグ**
   ```html
   <!-- 変更前 -->
   <script src="phrase.js" defer></script>
   <!-- 変更後 -->
   <script src="phrase.js" type="module"></script>
   ```
   `type="module"` は `defer` の挙動を含むため、`defer` は付けません。
   `register-sw.js` は `import` を使わないので `defer` のまま変更不要です。

2. **`sw.js`** — 新しいモジュールがキャッシュされないと、オフラインで真っ白になります。
   ```js
   const CACHE_NAME = "fingerstyle-practice-v10";  // リズム分割時の v9 から上げる
   ```
   `APP_SHELL` に `"./core/music.js"`, `"./core/clock.js"`, `"./core/notation.js"` を追加。

3. **CI** — `.github/workflows/validate.yml` の `node --check` の対象に3ファイルを追加。
   `package.json` に `"type": "module"` があるため、`node --check core/music.js` は ESM として解析されます。

> `npm test` に含まれる `scripts/validate-shell.mjs` が、`core/*.js` の3ファイルが `sw.js` の
> `APP_SHELL` に登録されているかを機械的に検査します。登録を忘れると `npm test` が落ちるので、
> 「オフラインで気づかないうちに壊れていた」は起きません。ここを通すことが上記2番の完了条件です。

---

## 7. バリデータの重複解消と単体テスト

### 7.1 `scripts/validate-phrases.mjs`

このファイルは `noteToMidi` / `openMidi` / `notePattern` / `supportedKeys` を**独自に再実装**しています。
描画側と検証側で定義がずれると、検証を通ったのに誤った譜面が出ます。

これらを削除し、`core/music.js` から import してください。

```js
import { noteToMidi, OPEN_MIDI, SUPPORTED_KEYS } from "../core/music.js";
```

**検証ロジック自体（閾値やエラーメッセージ）は変更しないこと。** `npm test` の出力が現状と同じであること。

### 7.2 `tests/unit/music.test.mjs`

Node標準のテストランナーを使い、`core/music.js` が**ブラウザ無しで動くこと**を証明します。
最低限、以下を含めてください。

| 対象 | 検証内容 |
|---|---|
| `noteToMidi` | `E2`=40, `A2`=45, `E4`=64, `C4`=60, `F#4`=66, `Bb3`=58 |
| `staffY` | `E4`=72, `C4`=84, `G3`=102, `E2`=156, `E5`=30, `G5`=18 |
| `noteToMidi` × `OPEN_MIDI` | 全フレーズ教材で 音名 と 弦/フレット が一致する |
| `keySignature` | `C`→0個、`G`→♯1個(y=66)、`F`→♭1個(y=90)、未知キー→空 |
| `annotateAccidentals` | ト長調のF♯に `accidentalGlyph === null`。同小節2つ目のF♯も `null` |
| `splitMeasures` | 4拍ごとに区切られ、`startBeat` が小節内でリセットされる |
| `computeLayout` | 低音を含むと `nameY` が最低音のy+12より大きい |
| `tabCellWidth` | 0.5拍→2、1拍→4、2拍→8、4拍→16。フレット10の8分音符→3 |

> **テストランナーは既に配線済みです。** `package.json` の `test` スクリプトには
> `node --test "tests/unit/*.test.mjs"` が入っており、`tests/unit/` には既存の
> `validate-shell.test.mjs` があります。**ファイルを追加するだけで走ります。**
> `package.json` とCIワークフローの変更は不要です。
>
> `node --test tests/unit/` のようにディレクトリを渡すとNode 22では `MODULE_NOT_FOUND` になるため、
> スクリプトを書き換える場合もglob形式（クォート必須）を維持してください。

---

## 8. 検証手順

作業完了を主張する前に、以下を**実際に実行して**出力を確認してください。

```bash
# 1. 構文
node --check guitar.js && node --check phrase.js && node --check sw.js \
  && node --check core/music.js && node --check core/clock.js && node --check core/notation.js

# 2. core/ がブラウザ無しで読めるか（P0の核心）
node -e 'import("./core/music.js").then(m => console.log(Object.keys(m).length + " exports"))'

# 3. 単体テスト + データ検証
npm test

# 4. ブラウザテスト24件（テストコードは変更しないこと）
npm install
npx playwright install chromium
npm run test:e2e
```

さらに、**手動で以下を目視確認**してください（自動テストが拾わない範囲です）。

```bash
npm run serve   # http://localhost:8000
```

- 基礎: メトロノームのSTART/STOP、±ボタンでテンポ変更（動作中に変えても位相が飛ばないこと）、課の前後移動
- フレーズ: 再生・停止・ループ、フレーズ切替（C長調とト長調の両方）、音符タップ、前/次、追従ON/OFF、伴奏3種のON/OFF
- DevTools の Application → Service Workers に `v10` のキャッシュが登録され、`core/*.js` が入っていること
- Console にエラーが1件も出ないこと

---

## 9. 受け入れ条件

- [ ] 着手時点のPlaywrightテストが**未変更のまま**全通過
- [ ] `npm test` 通過（単体テスト + レッスン検証 + フレーズ検証）
- [ ] `node -e 'import("./core/music.js")'` が成功する（＝ core/ がDOMに依存していない）
- [ ] `core/music.js` `core/clock.js` `core/notation.js` のいずれにも `document` `window` `AudioContext` の
      直接参照が無い（`clock.js` は引数で受け取った `context` のみ使用、`notation.js` は引数の `host` から
      `ownerDocument` 経由で要素を作る）
- [ ] `phrase.js` の行数が明確に減っている（目安: 829行 → 480行以下）
- [ ] `guitar.js` から `setInterval` によるスケジューラ実装が消えている
- [ ] `scripts/validate-phrases.mjs` に `noteToMidi` の再実装が残っていない
- [ ] `sw.js` の `CACHE_NAME` が `v10`、`APP_SHELL` に `core/*.js` の3ファイルがある
- [ ] `index.html` と `phrase.html` のアプリスクリプトが `type="module"`
- [ ] 譜面の見た目が変わっていない（C長調・ト長調の両方をスクリーンショットで比較）

---

## 10. やってはいけないこと

実装がこの種の逸脱をしがちなので、明示しておきます。

- **「ついでに」の改善をしない。** 命名の統一、コードの整形、未使用に見える変数の削除、
  `var`→`const` のような書き換えを、指示外の箇所で行わないこと。差分が読めなくなります。
- **音楽ロジックのアルゴリズムを書き直さない。** `staffY` の計算式、臨時記号の判定順序、
  TAB桁幅の式は、移設するだけで一切変更しないこと。
- **バンドラ・TypeScript・フレームワーク・npmパッケージを導入しない。**
  このアプリは GitHub Pages に静的配信されます。ビルド工程はありません。
- **テストを緩めない。** 落ちたテストを `skip` したり、アサーションを弱めたりしないこと。
- **`core/` からグローバル環境を参照しない。** 禁止しているのはDOMそのものではなく、
  `document` / `window` / `AudioContext` を**グローバルから掴むこと**です。詳細は§3の冒頭。
- **1つのコミットに全部詰め込まない。** §12の順に4コミットへ分けること。
  各コミット時点で `npm test` と `npm run test:e2e` の両方が通る状態を保つこと。

---

## 11. 完了報告に含めてほしいもの

- 4コミットのハッシュとメッセージ
- `npm test` と `npm run test:e2e` の実行結果（出力そのまま）
- `phrase.js` の変更前後の行数
- **移設ではなく判断を要した箇所があれば、その一覧と理由**
  （例:「`chordInfo` は音源側でしか使わないので `synth` 側に置くべきか迷ったが、
   和音記号の解析は音楽知識なので `music.js` に置いた」）
- 仕様に曖昧さを見つけた場合は、自己判断で埋めた内容を明記すること

---

## 12. コミットの分け方

**各コミット時点で `npm test` と `npm run test:e2e` の両方が通ること。**
この条件があるため、順序は入れ替えられません。

### Commit 1 — ESモジュール化の下準備のみ

```
index.html    guitar.js の script タグを type="module" へ
phrase.html   phrase.js の script タグを type="module" へ
sw.js         CACHE_NAME を v10 へ
```

- **この時点では `import` を1行も足さない。** ファイルの中身は変えません
- 動作・DOM・音・見た目は一切変わりません
- `APP_SHELL` の追加は不要です（新しいファイルがまだ無いため）
- 全テストPASSを確認

> **なぜ先にこれをやるのか。** `phrase.js` に `import` が入った瞬間、`phrase.html` が
> classic script のままだとブラウザは構文エラーで読み込みに失敗します。
> `type="module"` を後回しにすると、途中のコミットが必ず壊れます。

### Commit 2 — `core/music.js`

```
core/music.js                 新規（§3）
phrase.js                     音楽ロジックを import に置き換え
scripts/validate-phrases.mjs  重複実装を import に置き換え（§7.1）
tests/unit/music.test.mjs     新規（§7.2）
sw.js                         APP_SHELL に ./core/music.js を追加
```

- 全テストPASSを確認

### Commit 3 — `core/clock.js`

```
core/clock.js   新規（§4）
phrase.js       schedulerTick を置き換え
guitar.js       metronomeTick を置き換え
sw.js           APP_SHELL に ./core/clock.js を追加
```

- 全テストPASSを確認

### Commit 4 — `core/notation.js`

```
core/notation.js   新規（§5）
phrase.js          製譜部分を移設
sw.js              APP_SHELL に ./core/notation.js を追加
.github/workflows/validate.yml   node --check の対象に core/*.js を追加
```

- 全テストPASSを確認

### CACHE_NAME について

**バージョンを上げるのは Commit 1 の一度だけ**（v9 → v10）で構いません。
Commit 2〜4 は `APP_SHELL` へエントリを足すだけです。
ブランチ全体が1つの単位としてデプロイされるため、途中の版が配信されることはありません。

> `npm test` に含まれる `scripts/validate-shell.mjs` が、`core/*.js` の `APP_SHELL` 登録漏れを
> 検出します。**登録を忘れたコミットは `npm test` が落ちます。**
> これが「各コミットでテストが通る」を機械的に保証しています。
