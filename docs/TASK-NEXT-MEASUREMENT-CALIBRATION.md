# TASK — Phase 4B 測定意味論とレイテンシ校正

CURRENT PHASE: Phase 4 — 診断・測定・処方基盤

CURRENT SUBPHASE: Phase 4B — 測定意味論とレイテンシ校正

NEXT SUBPHASE: Phase 4C — 処方

---

## 1. 目的

Phase 4Bでは、演奏を数値化する前に **何が実測で、何が観察で、何が本人申告なのか** を固定します。

このSubphaseの目的は「100点満点の採点」を作ることではありません。
先に、測定値の出所、時間基準、レイテンシ、校正の有効範囲、不確かさ、測定不能条件を定義します。

Phase 4Aで導入した `reading / rhythm / execution / integrated` のfocus診断は維持します。
Phase 4Bで得た測定値を、校正や妥当性確認なしにfocusの能力スコアへ変換してはいけません。

---

## 2. 最重要原則

1. `measured` / `observed` / `reported` を別の証拠種別として保持する。
2. 自己評価を `measured` へ昇格させない。
3. 単なるアプリ内部イベントを、実演奏の正確さの測定値とみなさない。
4. 未校正のタイミング差を成績・能力値として保存しない。
5. 測定不能な状況では、推定値を捏造せず `unmeasurable` とする。
6. accuracy（正確さ）と precision（再現性・ばらつき）を混同しない。
7. 校正値には対象デバイス・入出力経路・時間基準・取得時点・符号規約を持たせる。
8. Phase 4B開始時点では、100点満点・総合能力スコア・レーダーチャートを作らない。

---

## 3. 証拠種別

### 3.1 `measured`

センサー、音声信号、ブラウザAPI、明示した解析器などから、**測定手順と単位を伴って直接得た値**です。

最低限、その値について次を説明できることを条件とします。

- 何を測ったか
- 単位
- 参照したclock / timestamp
- 測定経路
- 校正の有無
- 適用したcalibration offset
- 測定品質または不確かさを判断する根拠

例:

- 入力音声フレームの取得timestamp
- 既知の基準信号に対する検出時刻差
- 適切な条件下で得たRMS等の信号量

`reported.clean === true` のような本人申告は `measured` ではありません。
transportが完了したというアプリ内部事実だけから、演奏のタイミング精度を `measured` として生成してもいけません。

### 3.2 `observed`

アプリが直接確認した **セッション事実・状態遷移・出来事** です。
音楽的な正誤を推論せず、「起きたこと」を記録します。

例:

- transportが開始・停止した
- 選択区間を何loop完了した
- MediaRecorderが録音を開始・停止した
- 録音Blobが保存された
- focusが変更された
- calibration試行が完了・中断した

`observed.transportCompleted` は演奏成功を意味しません。

### 3.3 `reported`

ユーザー本人が入力した **自己評価・知覚・判断** です。

例:

- `reported.clean`
- ノイズ、粒、音色、流れのself-review
- 「合わせられた」「要復習」などの自己申告

`reported` は有用な診断材料ですが、センサー実測とは別物です。
UI・保存形式・診断文言でこの区別を崩してはいけません。

---

## 4. レイテンシ用語

### 4.1 `input latency`

物理的・音響的な入力イベントが発生してから、アプリが解析可能な入力信号またはtimestampとして利用できるまでの入力経路の遅延です。

概念上の経路:

```text
演奏 / 基準音
  ↓
空気・マイク
  ↓
OS / audio input path
  ↓
Web Audio / capture buffer
  ↓
アプリが参照できる入力時刻
```

「マイク権限取得にかかった時間」や「MediaRecorder停止までの待ち時間」とは別です。

### 4.2 `output latency`

`AudioContext.currentTime` 上で予約した出力イベントが、実際の音響出力としてユーザーへ届くまでの出力経路の遅延です。

概念上の経路:

```text
AudioContext timeline
  ↓
Web Audio graph
  ↓
OS / audio output path
  ↓
スピーカー / ヘッドホン
  ↓
実際の音響出力
```

`baseLatency` / `outputLatency` / `getOutputTimestamp()` 等を利用する場合も、API値が何を表すかを明示し、実測値と無条件に加算しないことを原則とします。

### 4.3 `calibration offset`

既知の基準イベントと観測されたイベントとの差から得る、**特定の測定経路に適用する補正量**です。

calibration offsetには最低限、次を結び付けます。

- 対象デバイスまたはブラウザ環境
- input / output / round-trip のどの経路か
- 使用したclock / timestamp convention
- 単位
- 符号規約
- 測定日時
- 測定回数
- ばらつき
- 適用可能条件

符号規約の例:

```text
correctedTime = observedTime - calibrationOffset
```

この規約を採用する場合、正のoffsetが「観測が基準より遅い」ことを意味すると明記します。
実装時に別の規約を採る場合も、保存データとテストで一意にします。

単一のoffsetを全デバイス・全入出力経路へ適用してはいけません。

---

## 5. accuracy と precision

### 5.1 `accuracy`

基準値・真値に対して、測定結果がどれだけ近いかを表します。
系統的なずれ（bias）が大きければ、繰り返し値が安定していてもaccuracyは低い状態です。

例:

- 毎回ほぼ同じ値だが常に +45 ms 遅れている
  - precision: 高い可能性
  - accuracy: 低い

### 5.2 `precision`

同じ条件で繰り返したときの、測定値の再現性・ばらつきの小ささを表します。

例:

- 平均は基準に近いが、試行ごとに ±80 ms ばらつく
  - accuracy: 平均だけなら高く見える可能性
  - precision: 低い

**高precisionは高accuracyを保証しません。**
校正では平均offsetだけでなく、試行間のばらつきも確認します。

---

## 6. calibrated / uncalibrated

### 6.1 `calibrated`

その測定値に対して、現在のデバイス・経路・時間基準・条件へ適用可能な校正情報が存在し、その校正を明示的に適用した状態です。

`calibrated` と呼ぶには最低限:

- calibration recordが存在する
- 対象経路が一致する
- timebase / timestamp semanticsが一致する
- 符号規約が明確
- calibration qualityが受け入れ条件を満たす
- 古すぎる・環境変更後など、失効条件に該当しない

ことを確認します。

### 6.2 `uncalibrated`

適用可能な校正情報が無い、または品質・条件一致を確認できない状態です。

uncalibratedな値をデバッグ・診断表示すること自体は禁止しません。
ただしUIと保存データで明示し、**成績・能力スコア・精密なタイミング判定へ使用してはいけません。**

---

## 7. measurable / unmeasurable

### 7.1 `measurable`

対象指標について、次が揃っている状態です。

- 操作的定義がある
- 必要な信号・イベントを観測できる
- 比較基準がある
- clock / timestamp関係が定義されている
- 必要な校正が有効
- 信号品質が最低条件を満たす

この条件を満たした場合にのみ、対象を `measured` として扱います。

### 7.2 `unmeasurable`

必要な信号、基準、校正、品質のいずれかが不足し、妥当な測定値を生成できない状態です。

例:

- 入力信号が無い
- クリッピングやS/N不足でイベント時刻を安定検出できない
- clock同士の関係が不明
- 必須校正が無い
- 複数音で対象イベントを一意に定義できない

この場合は `null` / unavailable相当と理由を返し、0点や推定値で埋めません。

---

## 8. 時間基準

Phase 2で確立した発音schedulerの原則を維持します。

- 発音予約の基準は `AudioContext.currentTime`
- timer callback時刻を発音時刻そのものとして扱わない
- STOP時は予約済みAudioNodeを取消する
- 測定層を導入するために `core/clock.js` の責務を演奏評価へ拡張しない

入力側timestampを導入する際は、`AudioContext.currentTime` と同じ座標系か、変換が必要な別座標系かを先に確認します。
clock変換を定義できない値同士を直接減算して「遅れ」と呼んではいけません。

---

## 9. Phase 4Bで先に決めるデータ境界

実装前に、少なくとも次の概念境界を決めます。

```text
Attempt
  conditions
  observed   <- セッション事実
  reported   <- 本人申告
  measured?  <- 妥当な測定だけ。未校正値を暗黙に格納しない
```

既存Attemptの `observed` / `reported` 意味論は維持します。
既存データをmigrationして架空の `measured` 値を生成してはいけません。

calibration recordはAttemptと寿命が異なるため、同じオブジェクトへ雑に埋め込まず、適用対象と失効条件を定義してから保存方式を決めます。

---

## 10. 校正フローを実装する前の設計ゲート

次を文書またはテストで回答できるまで、自動タイミング評価を実装しません。

1. 何を基準イベントとするか
2. input / output / round-trip のどれを測るか
3. 使用するtimestampは何か
4. clock変換は必要か
5. offsetの符号はどちら向きか
6. 何回測定するか
7. 外れ値をどう扱うか
8. precisionを何で表すか
9. どの条件でcalibratedと判定するか
10. デバイス・経路変更時にいつ失効させるか
11. 測定不能をどう表現するか
12. uncalibrated値をUIでどう明示するか

---

## 11. Phase 4Bでまだ作らないもの

- 100点満点の演奏スコア
- 総合能力スコア
- 能力レーダーチャート
- 未校正onset差による合否
- 未校正pitch / timingの自動採点
- reading / rhythm / execution / integratedを単一値へ潰す処理
- AIによる主観的な演奏点数
- 音源分離
- 自動採譜
- Phase 4Cの本格処方エンジン

---

## 12. 最初の実装候補

Phase 4Bの実装は、以下の順で小さく進めます。

1. 測定・校正の型／validationを定義する
2. `measured` / `observed` / `reported` の混同を防ぐunit testを置く
3. calibration recordの最小schemaを定義する
4. clock / timestamp意味論をテストする
5. 校正試行の収集とprecision確認を作る
6. calibrated / uncalibrated / unmeasurableをUIで区別する
7. その後にのみ、限定された測定指標を検討する

この順序を飛ばして自動採点へ進まないこと。

---

## 13. 受け入れ条件

Phase 4Bの実装PRを作る前に最低限、以下を満たします。

- [x] `measured` を定義した
- [x] `observed` を定義した
- [x] `reported` を定義した
- [x] `input latency` を定義した
- [x] `output latency` を定義した
- [x] `calibration offset` を定義した
- [x] `accuracy` と `precision` を分離した
- [x] `calibrated` / `uncalibrated` を定義した
- [x] `measurable` / `unmeasurable` を定義した
- [x] 未校正値を採点へ使わない原則を明記した
- [x] 100点満点・総合能力スコアをまだ作らないと明記した
- [ ] calibration schemaを実装する
- [ ] calibration acceptance testを追加する
- [ ] ブラウザでの校正フローを実装する
- [ ] Phase 4B用PRを作成する

---

## 14. Phase 4B完了の定義

このTASK文書を作っただけではPhase 4B COMPLETEではありません。

Phase 4B完了には、少なくとも:

- 測定意味論がコード上のschema / validationへ反映される
- calibration recordの適用条件が検証される
- calibrated / uncalibrated / unmeasurableが混同されない
- 既存Phase 1–4Aの練習・録音・診断が回帰しない
- unit / E2E / GitHub Actionsがgreen
- Phase 4B PRが `main` へマージされる

ことを要求します。

完了後は **Phase 4C — 処方** へ進みます。
