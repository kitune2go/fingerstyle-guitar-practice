# 次タスク — Phase 3 録音・自己モニタリング

## PHASE STATUS

- **TARGET PHASE: Phase 3 — 録音・自己モニタリング**
- **STATUS: NEXT**
- **PREREQUISITE: Phase 2 — 共通時間基盤を完了し、PR #12 が main へマージ済みであること**
- **NEXT PHASE: Phase 4 — 測定・処方基盤**

このタスクを開始する最初のコミットで `docs/ROADMAP.md` の `CURRENT PHASE` を Phase 3 へ更新してください。
Phase 2 が未完了なら、このタスクの実装を開始してはいけません。

---

## 1. 目的

フレーズ練習で、利用者自身の演奏をスマートフォンのマイクから録音し、停止後に同じAttemptの文脈で聴き返せるようにします。

このPhaseの目的は **自動採点ではありません**。

成立させるループは次です。

```text
練習条件を決める
  ↓
録音を有効にして演奏
  ↓
停止 / 区間完了
  ↓
録音を聴き返す
  ↓
簡単な自己レビュー
  ↓
Attemptとして保存
```

`ear.selfmonitor` を実際の練習へ組み込み、Phase 4 の測定へ進む前に「Attemptと録音」の関係を固定します。

---

## 2. 不変条件

以下を破る変更は不合格です。

1. GitHub Pagesの静的配信を維持する
2. バンドラ / TypeScript / フレームワーク / 実行時npm依存を追加しない
3. PR #12 の `core/clock.js` を変更目的にしない
4. 発音時刻は引き続き `AudioContext.currentTime` 基準
5. 録音開始時刻をサンプル精度の演奏測定値として扱わない
6. マイク入力をスピーカーへmonitorしない
7. マイク権限は明示的なユーザー操作からだけ要求する
8. 権限拒否・非対応・録音失敗でも通常の練習再生は使える
9. 自動タイミング採点・自動ピッチ採点を入れない
10. 録音と自己評価を `measured` データとして扱わない
11. 既存AttemptのJSONバックアップ互換性を壊さない
12. DOM / 譜面 / 教材JSON / 音源 / 伴奏パターンを不要に変更しない

---

## 3. ブラウザAPI方針

録音には標準Web APIを使用します。

- `navigator.mediaDevices.getUserMedia({ audio: ... })`
- `MediaRecorder`
- `MediaRecorder.isTypeSupported()` によるMIME feature detection
- `Blob`
- `IndexedDB`

固定の録音形式を仮定しないでください。

候補は概ね次の順で確認して構いません。

```text
audio/webm;codecs=opus
audio/mp4
audio/webm
```

ただし、最終的には `MediaRecorder.isTypeSupported()` で現在のブラウザが受け入れる形式だけを指定し、どれも明示指定できなければ `new MediaRecorder(stream)` のブラウザ既定値へフォールバックしてください。

録音Blobの実際の `mimeType` は保存メタデータに残します。

### マイク制約

ギターの音色・ダイナミクスを自己確認する目的なので、可能なら次を要求します。

```js
{
  audio: {
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false
  }
}
```

ただしブラウザ・端末が無視する可能性があります。
`MediaStreamTrack.getSettings()` が利用できる場合は、実際に適用された設定をメタデータへ残してください。

このPhaseでは、その設定差を補正したり採点へ使ったりしません。

---

## 4. 新規モジュール

推奨:

```text
core/recorder.js
```

`core/` の規約に従い、`navigator` / `window` / グローバル `MediaRecorder` を直接取得してはいけません。
依存は呼び出し側から渡します。

概念API:

```js
export function createRecorder({
  mediaDevices,
  MediaRecorderClass
} = {})
```

戻り値の責務は最低限:

```js
{
  request(),
  start(),
  stop(),
  cancel(),
  get state()
}
```

実際の命名は既存コードへ合わせて調整して構いませんが、責務を `phrase.js` にべた書きしないでください。

### recorderが担当するもの

- マイク取得
- 対応MIMEの選択
- MediaRecorder lifecycle
- dataavailable chunkの収集
- Blob生成
- MediaStreamTrackの停止
- unsupported / denied / failed の状態表現

### recorderが担当しないもの

- 小節
- フレーズ
- テンポ
- 予備拍
- loop
- Attempt評価
- IndexedDB永続化
- UI文言
- 自動測定

---

## 5. 録音開始と停止

### 権限要求

ページロード時にマイク権限を要求してはいけません。

利用者が例えば

```text
● 録音して練習
```

を明示的に押した時だけ取得します。

権限拒否時は日本語で説明し、通常の `▶ 再生` はそのまま使用可能にしてください。

### 開始

録音を選んだ状態でフレーズ再生する場合:

1. マイクStreamを取得済みであることを確認
2. MediaRecorderを開始
3. 既存のPhase 2 clockでフレーズtransportを開始

録音開始と `AudioContext.currentTime` の差をPhase 4のタイミング測定へ流用してはいけません。
MediaRecorderは自己モニタリング用であり、サンプル精度の測定時計ではありません。

### 停止

以下の全経路でRecorderとMediaStreamTrackを確実に停止してください。

- STOPボタン
- 区間再生の自然終了
- フレーズ変更
- assist / range / tempo / backing変更による既存stop
- `visibilitychange` でhidden
- `pagehide`
- 録音エラー

`stop()` / `cancel()` は多重呼び出ししても安全にしてください。

MediaStreamをAudioContext destinationへ接続してはいけません。ハウリングを起こすためです。

---

## 6. Attemptとの関連付け

録音は **1つのAttempt候補に対して最大1つ** とします。

推奨:

- 再生開始時に run ID を先に生成する
- Attempt ID と recordingの `attemptId` に同じIDを使う
- transport停止後、録音Blobが完成するまでは保存UIを待機状態にする

既存のAttempt schemaで `id` を停止時に生成している場合は、開始時生成へ移して構いません。
ただしIDの意味を変えず、既存バックアップを壊さないでください。

### 保存単位

録音BlobをAttempt本体へ直接埋め込まないでください。

IndexedDBをversion 2へ上げ、別storeを推奨します。

```text
attempts     keyPath: id
recordings   keyPath: attemptId
```

recording例:

```js
{
  attemptId,
  createdAt,
  mimeType,
  size,
  blob,
  settings: {
    sampleRate,
    channelCount,
    echoCancellation,
    noiseSuppression,
    autoGainControl
  }
}
```

利用できないsettingsは省略またはnullにしてください。
偽の値を補完しないでください。

### JSONバックアップ

既存の練習JSONバックアップへ録音Blobを含めないでください。

理由:

- 既存5MB上限と衝突する
- 音声をbase64化すると巨大になる
- Attempt履歴の可搬性と録音データの容量問題を分離したい

UIには

```text
録音はこの端末内に保存され、練習記録JSONには含まれません
```

と明示してください。

必要なら個別録音のファイル保存は別ボタンで許可して構いませんが、Phase 3の必須条件ではありません。

---

## 7. 保存の整合性

Attemptだけ保存され録音だけ消える、または録音だけ孤児になるケースを最小化してください。

推奨は `practice-store.js` をversion 2対応にし、Attemptと録音を同じIndexedDB transactionで保存できるAPIを追加することです。

例:

```js
saveAttempt(attempt, recording = null)
```

ただし既存 `addMany()` のimport用途は維持してください。

既存IDを上書きしないimportポリシーも維持します。

録音保存がQuotaExceeded等で失敗した場合:

- Attemptまで失われない設計にするか
- 両方を未保存として再試行可能にするか

どちらかを明示的に選び、テストとPR本文に記載してください。

無言で片方だけ成功させないでください。

---

## 8. 自己モニタリングUI

録音停止後、Attempt保存前に最低限次を提供します。

- 録音あり / なしの表示
- `<audio controls>` 等による聴き返し
- 録音削除 / やり直し
- 既存の「弾けた / 要復習」
- 簡単な自己レビュー

自己レビューは自動スコアへ変換しません。

推奨4項目:

1. 不要弦・ノイズ
2. 音量・粒の揃い
3. 音色
4. フレーズの流れ

値は例えば3段階に限定します。

```text
1 = 要改善
2 = まずまず
3 = 良い
```

保存先は `reported.review` 等、**自己評価であることが構造から分かる場所**にしてください。

総合点やレーダーチャートはこのPhaseでは作りません。

既存Attemptはreview無しでも引き続きvalidである必要があります。

---

## 9. 録音時間と容量

loopを無制限に録音すると端末ストレージを圧迫します。

Phase 3では録音に上限を設けてください。

推奨:

```text
最大10分
```

上限到達時:

- 録音だけ安全に停止
- 練習transportを強制停止する必要はない
- 「録音は10分で停止しました。練習は続けられます。」と表示

サイズだけでなく時間にも上限を持たせ、巨大Blobができるまで放置しないでください。

---

## 10. エラーと非対応

最低限区別する状態:

- MediaRecorder非対応
- mediaDevices非対応
- permission denied
- device not found
- recorder start failure
- recorder runtime error
- IndexedDB recording save failure
- storage quota failure

利用者向けUIは日本語で簡潔にします。

**録音機能の失敗で譜面・通常再生・既存Attempt記録を壊してはいけません。**

---

## 11. テスト

### Unit

新規推奨:

```text
tests/unit/recorder.test.mjs
```

実時間マイクへ依存せずfakeを注入します。

最低限:

1. Node環境でブラウザグローバルなしにimport可能
2. MediaRecorder非対応を判定できる
3. MIME候補をfeature detectする
4. getUserMedia成功で録音開始できる
5. chunkからBlobを生成する
6. stopで全MediaStreamTrackを停止する
7. stop多重呼び出しが安全
8. permission deniedを通常エラー状態として返す
9. recorder errorでもtrackを解放する
10. cancel時に録音を永続化対象へしない

### practice-store

最低限:

- DB v1 → v2 upgradeで既存Attemptを保持する
- Attempt + recordingの保存
- recording無しAttemptの保存
- attemptIdで録音を取得
- recording削除
- import時に録音storeを壊さない
- Quota / transaction abort時の採用ポリシー

### E2E

実マイクデバイスへ依存させないでください。
CIではMediaRecorder / getUserMediaをstubするか、Playwrightのfake media deviceを明示設定します。

最低限:

1. ページロードだけではマイク権限を要求しない
2. 「録音して練習」操作からだけマイク取得する
3. 録音 → STOP → audio player表示
4. 録音付きAttemptを保存して再読込後も聴ける
5. 録音無し通常練習が従来どおり動く
6. 権限拒否でも通常再生できる
7. フレーズ変更 / pagehide / visibilitychangeでtrackが残らない
8. 録音はJSONバックアップへ混入しない

---

## 12. Service Worker

`core/recorder.js` 等のローカルファイルを追加した場合:

- `sw.js` の `APP_SHELL` へ追加
- `CACHE_NAME` を1つ上げる
- `validate-shell.mjs` 成功を確認

録音Blob自体をService WorkerのCache Storageへ保存しないでください。
録音はIndexedDBの責務です。

---

## 13. 今回やらないこと

次をPhase 3へ混ぜないでください。

- 音声波形エディタ
- 自動オンセット検出
- 自動タイミング採点
- ピッチ検出
- レイテンシ校正
- 能力レベル自動更新
- 自動処方
- クラウドアップロード
- 共有URL
- stem separation
- 自動採譜
- WebKit CI全体導入

これらはPhase 4以降です。

---

## 14. 受け入れ条件

```text
[ ] ROADMAPのCURRENT PHASEがPhase 3へ更新されている
[ ] マイク権限は明示操作からのみ要求される
[ ] 録音しながら既存フレーズ練習ができる
[ ] STOP / 自然終了で録音が確定する
[ ] 録音をその場で聴き返せる
[ ] 録音とAttemptが同一IDで関連付く
[ ] IndexedDB v1からv2へ既存記録を失わずupgradeできる
[ ] 録音はJSONバックアップへ含まれない
[ ] 録音失敗・権限拒否でも通常練習できる
[ ] 全MediaStreamTrackが停止される
[ ] 10分上限または同等の容量保護がある
[ ] 自己レビューがreported系データとして保存される
[ ] 自動採点を実装していない
[ ] npm test 成功
[ ] npm run test:e2e 成功
[ ] git diff --check 成功
[ ] GitHub Actions 成功
```

---

## 15. 完了報告

必ず次を報告してください。

1. 開始時 CURRENT PHASE: Phase 3
2. 終了時 CURRENT PHASE: Phase 3
3. Phase判定: 完了 / 継続
4. NEXT PHASE: Phase 4 — 測定・処方基盤
5. ブランチ名
6. コミットSHA一覧
7. 変更ファイル一覧
8. `npm test` 結果
9. `npm run test:e2e` 結果
10. `git diff --check` 結果
11. GitHub Actions conclusion
12. MediaRecorder MIME選択方針
13. permission denied / quota failure時の挙動
14. IndexedDB v1→v2 migration結果
15. 録音とAttemptの整合性をどう保証したか
16. 自動採点を意図的に実装していないこと
