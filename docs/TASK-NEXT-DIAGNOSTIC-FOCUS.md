# 次タスク — Phase 4A 診断focusモデル

## PHASE STATUS

- **TARGET PHASE: Phase 4 — 診断・測定・処方基盤**
- **SUBPHASE: Phase 4A — 診断focusモデル**
- **STATUS: NEXT**
- **PREREQUISITE: Phase 3 — 録音・自己モニタリングのPRがmainへマージ済みで、CI成功していること**
- **NEXT SUBPHASE: Phase 4B — 測定意味論とレイテンシ校正**

Phase 3 が未完了なら、このタスクの実装を開始してはいけません。
Phase 4開始時の最初のコミットで `docs/ROADMAP.md` の `CURRENT PHASE` を Phase 4 へ更新してください。

---

## 1. 目的

「この8小節が弾けない」を一つの失敗として扱わず、同じ素材を次の4focusで分解して原因を切り分けます。

```text
reading
rhythm
execution
integrated
```

最終目的は統合演奏ですが、練習中は処理を分けます。

```text
integratedで詰まる
  ↓
reading / rhythm / execution を同一素材で確認
  ↓
弱いfocusだけ練習
  ↓
integratedへ戻す
```

このPhaseでは自動採点を完成させません。
まず「何を練習したAttemptなのか」を正しく区別できる構造を作ります。

---

## 2. 最重要原則

### 教材を4倍にしない

4種類のphrase JSONを作ってはいけません。

同じ `phraseId` / `range` に対して `focusMode` を変えます。

```js
{
  phraseId: "a7-blues-rock",
  start: 3,
  end: 4,
  tempo: 80,
  focusMode: "rhythm"
}
```

### 4focusを総合点へ潰さない

`reading` 成功は `execution` 成功ではありません。
`rhythm` 成功は `integrated` 成功ではありません。

別条件として履歴を持ち、比較可能にします。

### 分離したまま終わらない

最終チェックは必ず `integrated` です。
分解練習は原因切り分けと弱点練習のためであり、統合演奏を置き換えません。

---

## 3. focusMode定義

`core/practice.js` に共有定義を置くことを推奨します。

```js
export const FOCUS_MODES = Object.freeze({
  reading: "譜読み",
  rhythm: "リズム",
  execution: "演奏動作",
  integrated: "統合演奏"
});
```

意味:

### reading

主対象:

- 五線譜 → 音名
- 度数
- 弦 / フレット候補
- 指板位置

軽くするもの:

- 正確な発音
- 音色
- タイミング精度
- 左右同期

### rhythm

主対象:

- 拍
- 細分
- アクセント
- 発音タイミング

軽くするもの:

- 正しい音高
- 運指選択
- 音色

### execution

主対象:

- 左右同期
- 弦移動
- ピッキング / 指弾き
- 押弦
- 発音品質

軽くするもの:

- 初見処理
- 音名判断
- 譜読み負荷

### integrated

主対象:

- 正しい音高
- 正しいリズム
- 奏法
- 読譜
- 演奏継続

通常のフレーズ練習は `integrated` 相当です。

---

## 4. Attempt互換

`conditions.focusMode` を追加します。

新規Attemptでは必須です。

既存Attempt / version 1 backupには `focusMode` がありません。
既存データを破壊しないため、読み込み・正規化時に欠落している場合のみ `integrated` とみなしてください。

既存JSONバックアップ形式を不必要にversion 2へ上げないでください。
後方互換で表現できるならversion 1を維持します。

ただし保存時には正規化済みAttemptへ `focusMode` を含めてください。

`practiceAdvice()` の「同じ条件」判定にもfocusModeを含めます。

---

## 5. 4focusを意味の違う練習にする

**単なるラベルだけのselectorにしてはいけません。**
同じ通常演奏を4つの名前で保存すると診断データが偽物になります。

最初の実装では豪華な専用画面は不要ですが、最低限それぞれの負荷を実際に分離してください。

### reading 最小プロトコル

選択rangeの音符を順に確認できる既存のnote trainer / scoreを再利用します。

- お手本メロディや伴奏を診断の必須条件にしない
- 音名 / 弦フレットを「見る前に考える → reveal」の流れを作る
- transport完遂をreading成功の根拠にしない
- 自動正誤判定が無い場合は `reported` として記録する

### rhythm 最小プロトコル

phrase modelの**音高ではなくonset / duration構造**を再利用します。

- 同じrangeのリズムを中立音 / クリック等で提示する
- ギターならミュート弦、手拍子、口唱歌で合わせられる設計にする
- 正しいpitchを要求しない
- `core/clock.js` のAudioContext時間基盤を使用する
- setInterval / setTimeoutから直接発音しない

### execution 最小プロトコル

- 短い選択rangeを使う
- 譜読み負荷を下げる
- memory / reveal / assistの既存機構を再利用する
- 演奏録音と自己レビューを利用できる
- 初見の成否をexecution結果として扱わない

### integrated

現在の通常フレーズ練習を基準にします。

- score
- pitch
- rhythm
- technique
- backing / melody条件

を組み合わせた現行フローです。

---

## 6. UI方針

`phrase.html` 内に1つの「練習focus」選択を置く方式を優先します。
4ページ複製はしません。

例:

```text
練習focus
[ 譜読み | リズム | 演奏動作 | 統合演奏 ]
```

選択したfocusに応じて、その下へ短い説明を表示してください。

重要:

- focus変更時は現在のtransport / recordingを安全に停止する
- focus変更はAttempt条件へ残す
- focus変更で教材JSON自体を書き換えない
- 390px幅で横スクロールしない
- keyboard操作とfocus-visibleを維持する

---

## 7. 診断表示

このSubphaseでは精密な自動採点はまだ不要です。

最低限、同じphrase/rangeについてfocus別の直近状況を区別して表示できればよいです。

例:

```text
M3–M4 / 80 BPM
譜読み      要復習
リズム      達成（自己評価）
演奏動作    要復習
統合演奏    要復習
```

これを一つの「62点」のような数字へ変換してはいけません。

---

## 8. 処方の最小ルール

Phase 4Aではルールベースの案内までに留めて構いません。

- integrated失敗 + reading失敗 → readingを優先
- integrated失敗 + rhythm失敗 → rhythmを優先
- integrated失敗 + execution失敗 → executionを優先
- reading/rhythm/execution成功 + integrated失敗 → integrated練習を継続
- integrated成功 → 次range / tempo / assist候補へ進む

同時に複数focusが弱い場合、断定的な単一原因にしないでください。

---

## 9. Phase 4Aで実装しないもの

次はPhase 4B以降です。

- 精密な自動タイミング採点
- 自動ピッチ採点
- onset detectorの本番運用
- レイテンシ校正
- RMSスコア
- 能力レベルの数値自動更新
- 機械学習による処方

次はPhase 6です。

- 大規模教材追加
- focusごとの高度な専用画面
- 休符 / 複声部 / 任意拍子の本格拡張

---

## 10. テスト

最低限:

### unit

- focusModeの4値を受理
- 未知focusを拒否
- legacy Attemptの欠落focusをintegratedへ正規化
- backup import互換
- `practiceAdvice` がfocusの違うAttemptを同条件扱いしない
- focus別集計を混ぜない

### E2E

- focus selectorが4値を切り替えられる
- focus変更時に再生 / 録音が停止する
- 同じphrase/rangeを変えずにfocusだけ変えられる
- readingが通常transport完遂を成功根拠にしない
- rhythmがpitch依存の再生になっていない
- executionで録音・自己レビューが使える
- integratedで既存フレーズ練習が回帰しない
- 390pxで横スクロールしない

既存テストをskip・弱体化してはいけません。

---

## 11. 受け入れ条件

```text
[ ] CURRENT PHASEがPhase 4へ更新されている
[ ] focusModeがreading/rhythm/execution/integratedの4値で定義されている
[ ] 既存Attemptはintegratedとして後方互換に読める
[ ] 新規AttemptにfocusModeが保存される
[ ] 同じphrase/rangeを4focusで再利用する
[ ] 4種類の教材JSONを複製していない
[ ] focusごとに練習負荷が実際に異なる
[ ] focus別履歴を混ぜない
[ ] 総合点へ潰していない
[ ] AudioContext時間基盤を維持
[ ] npm test成功
[ ] npm run test:e2e成功
[ ] git diff --check成功
[ ] GitHub Actions成功
```

---

## 12. 完了報告

必ず以下を報告してください。

- 開始時 CURRENT PHASE
- 終了時 CURRENT PHASE
- Phase 4A 完了 / 継続
- 次Subphase: Phase 4B — 測定意味論とレイテンシ校正
- ブランチ
- PR
- コミットSHA
- focusModeの保存形式
- legacy Attempt互換方針
- reading / rhythm / execution / integratedの実際の挙動差
- focus別集計と処方ルール
- npm test
- npm run test:e2e
- git diff --check
- GitHub Actions conclusion
- 自動採点をPhase 4Aへ混ぜていないこと
