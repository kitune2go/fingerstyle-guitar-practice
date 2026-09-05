# 次タスク — `core/clock.js` 共通化

## PHASE STATUS

- **CURRENT PHASE: Phase 2 — 共通時間基盤**
- **STATUS: CURRENT / PR #12 review and merge gate**
- **NEXT PHASE: Phase 3 — 録音・自己モニタリング**

このタスクの完了条件は、実装と検証の成功に加えて PR #12 が `main` へマージされることです。
完了後は `docs/TASK-NEXT-RECORDING.md` に従い Phase 3 を開始します。

## 0. 前提

- 対象: `kitune2go/fingerstyle-guitar-practice`
- PR #11 を `main` へマージした後に開始する
- 新しい作業ブランチは最新 `main` から切る
- `AGENTS.md` と `docs/ROADMAP.md` を先に読む
- このタスクは **リファクタリング**。録音・採点・教材追加は含めない

推奨ブランチ名:

```text
refactor/shared-audio-clock
```

## 1. 目的

`guitar.js` と `phrase.js` に残っている先読みスケジューラを `core/clock.js` へ集約し、再生・メトロノーム・将来の測定が同じ時間基盤を使う状態にします。

現在は両画面とも発音自体は `AudioContext.currentTime` に予約しているため、問題は「setIntervalで直接鳴らしている」ことではありません。
問題は、同じ責務の実装が二本あり、lookaheadや停止条件が別々に進化できてしまうことです。

このタスクでは **再生音・表示・操作感を変えずに時計だけを共通化**します。

## 2. 不変条件

以下を1つでも破ったら不合格です。

1. `guitar.js` / `phrase.js` の発音時刻は引き続き AudioContext 時刻で予約する
2. `setInterval` / `setTimeout` から直接発音しない
3. 再生中のテンポ変更は次の予約スロットから反映する
4. PR #11 の区間再生・予備拍・停止時予約取消を壊さない
5. フレーズの32分音符・付点・連符再生を12tick固定へ戻さない
6. DOM契約・CSS・教材JSONを変更しない
7. 音源、ゲイン、エンベロープ、伴奏パターンを変更しない
8. ビルド工程・実行時npm依存を追加しない
9. `core/clock.js` は `window` / `document` / グローバル `AudioContext` を参照しない
10. 既存テストを弱めたりskipしたりしない

## 3. 新規モジュール

作成:

```text
core/clock.js
```

推奨API:

```js
export function createScheduler({
  context,
  lookahead = 0.15,
  tickMs = 25,
  setTimer = setInterval,
  clearTimer = clearInterval,
} = {})
```

戻り値:

```js
{
  start(firstTime, onSlot),
  stop(),
  get running()
}
```

### `start(firstTime, onSlot)`

- `firstTime`: 最初に処理する AudioContext 時刻
- `onSlot(time)`: その時刻へ予約すべき1単位分の処理
- `onSlot` の戻り値:
  - `number > 0`: 次のスロットまでの秒数
  - `null`: これ以上スロットを進めない
- start直後に1回キューを補充し、その後タイマーで補充を続ける
- 二重startを許さない。既存start中なら明示的に例外にするか、既存仕様に合わせて安全に無視する。どちらにしたかテストと完了報告に明記する

### `stop()`

- 内部タイマーだけを止める
- 予約済みAudioNodeの停止・UI変更は行わない
- 音の取消は引き続き呼び出し側の責務
- 複数回呼んでも安全

### 時刻追従

内部では概念的に次を行います。

```js
while (nextTime < context.currentTime + lookahead) {
  const step = onSlot(nextTime);
  if (step == null) stopScheduling;
  else nextTime += step;
}
```

ただし無限ループ防止として、`onSlot` が0以下・NaN・Infinityを返した場合は明示的エラーにしてください。

## 4. `guitar.js` の移行

現在の `metronomeTick()` / `metronomeTimer` 相当を共通スケジューラへ置き換えます。

呼び出し側は拍番号を保持します。

概念:

```js
scheduler.start(firstBeatTime, (time) => {
  scheduleClick(time, state.beatInBar === 0);
  state.beatInBar = (state.beatInBar + 1) % 4;
  return 60 / state.tempo;
});
```

重要:

- tempoはコールバック実行時に毎回 `state.tempo` を読む
- STOP時は scheduler.stop() に加えて、既存どおり予約済み音源とvisual pulseを取消す
- `CLICK_LOOKAHEAD` / `CLICK_TICK_MS` の画面側定数は削除し、共通モジュールの既定値へ寄せる

## 5. `phrase.js` の移行

PR #11 後のフレーズ再生は音符の拍位置を基準にしているため、旧12tickモデルへ戻さず、現在のイベント列をそのままスケジューラから駆動します。

共通スケジューラが知るのは **次の予約時刻**だけです。

以下は画面側に残します。

- 選択区間
- 予備拍
- ループ境界
- フレーズイベントの位置
- 伴奏コード位置
- 再生完了判定
- Attempt用の再生条件
- 予約済みAudioNodeの追跡と取消

`core/clock.js` にフレーズ固有の bar / note / loop 状態を持たせないでください。

lookahead は **0.15秒**に統一します。

## 6. テスト

### 単体テスト

新規:

```text
tests/unit/clock.test.mjs
```

最低限、次を検証します。

1. start直後にlookahead範囲を予約する
2. context.currentTimeの進行に応じて次のスロットを補充する
3. `onSlot` の返した可変間隔が使われる
4. `null` で予約を終了する
5. stopでタイマーが解除される
6. stopを複数回呼んでも安全
7. 不正なstep（0 / 負数 / NaN / Infinity）を拒否する
8. ブラウザグローバルなしでNodeからimportできる

タイマーテストは実時間sleepへ依存させず、`setTimer` / `clearTimer` を注入して決定論的に行ってください。

### 既存回帰

既存のPlaywrightテストは原則変更しません。

追加するなら、共通時計化で壊れやすい次だけに絞ります。

- 基礎メトロノームをSTART → tempo変更 → STOP
- フレーズ区間ループをSTART → STOPし、予約音が復活しない
- 予備拍後に選択区間の先頭が正しい時刻で始まる

既存テストで十分なら追加不要です。テスト数を増やすこと自体を目的にしません。

## 7. Service Worker / 検証

`core/clock.js` を新規追加するため、必ず:

- `sw.js` の APP_SHELL に追加
- `CACHE_NAME` を1つ上げる
- `scripts/validate-shell.mjs` が成功することを確認

CIのJavaScript構文検査は `find core ...` で拾えるはずですが、実際に確認してください。

## 8. 今回やらないこと

次を同じPRへ入れないでください。

- 録音
- マイク権限
- レイテンシ校正
- 自動採点
- WebKit CI追加
- 教材追加
- 休符 / 複声部 / 変拍子
- サンプル追加
- 自動採譜
- UIデザイン変更

時計の共通化だけでレビュー可能な差分にします。

## 9. 受け入れ条件

完了条件:

```text
[ ] CURRENT PHASE が Phase 2 と明示されている
[ ] core/clock.js が追加されている
[ ] guitar.js の独自先読みループが除去されている
[ ] phrase.js の独自先読みループが除去されている
[ ] lookahead が0.15秒に統一されている
[ ] AudioContext.currentTime基準を維持している
[ ] PR #11 の区間・予備拍・停止取消が維持されている
[ ] 既存の音・DOM・教材データに意図しない差分がない
[ ] clock単体テストが決定論的に通る
[ ] npm test 成功
[ ] npm run test:e2e 成功
[ ] git diff --check 成功
[ ] GitHub Actions 成功
[ ] PR #12 が main へマージされている
```

## 10. 完了報告

次をそのまま提示してください。

1. 開始時 CURRENT PHASE: Phase 2
2. 終了時 CURRENT PHASE: Phase 2
3. Phase判定: 完了 / 継続
4. NEXT PHASE: Phase 3 — 録音・自己モニタリング
5. ブランチ名
6. コミットSHA一覧
7. 変更ファイル一覧
8. `npm test` の末尾出力
9. `npm run test:e2e` の結果
10. `git diff --check` の結果
11. GitHub Actions URL / conclusion
12. start二重呼び出し等、仕様に判断余地があった点と採用した挙動
13. 音・表示・操作の意図的変更が「なし」であること
