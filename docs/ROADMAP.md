# ギター練習帖 ロードマップ

この文書は、機能追加のたびに優先順位と「現在どこまで進んでいるか」がぶれないようにするための実装ロードマップです。
長期の能力モデルと測定設計は `ARCHITECTURE.md`、個別タスクの受け入れ条件は `TASK-*.md` を正とします。

---

## CURRENT PHASE: Phase 4 — 診断・測定・処方基盤

**状態: CURRENT**

**CURRENT SUBPHASE: Phase 4A — 診断focusモデル**

**NEXT SUBPHASE: Phase 4B — 測定・処方**

Phase 3 — 録音・自己モニタリングは PR #13 の `main` マージにより完了しました。
現在は `docs/TASK-NEXT-DIAGNOSTIC-FOCUS.md` を正として Phase 4A を実装します。

---

## 0. フェーズ運用ルール

進捗は **Phase 0〜7 の直列段階**で管理します。

1. `docs/ROADMAP.md` の先頭には常に **CURRENT PHASE** を1つだけ明記する
2. 各 `TASK-*.md` の冒頭に対象PhaseとNEXT PHASEを明記する
3. 各PR本文に対象Phaseと完了条件を明記する
4. 完了条件を満たすまで次Phaseの機能を混ぜない
5. 次Phaseの最初のコミットで `CURRENT PHASE` を更新する
6. 完了報告には開始Phase、終了Phase、完了/継続、次Phaseを必ず含める

「何を実装したか」だけでなく、**ロードマップ上のどこまで到達したか**を報告対象にします。

---

## 1. フェーズ一覧

| Phase | 名称 | 状態 | 主目的 |
|---|---|---|---|
| 0 | 配信・再生・譜面基盤 | DONE | 静的配信、オフライン、テスト、音源、譜面の土台 |
| 1 | 集中練習ループ | DONE | 区間反復、Assist Fade、予備拍、条件付きAttempt |
| 2 | 共通時間基盤 | DONE | 発音・将来の測定が共有する AudioContext clock |
| 3 | 録音・自己モニタリング | DONE | 演奏を録音し、聴き返して自己評価する |
| 4 | 診断・測定・処方基盤 | **CURRENT** | focusMode、measured/observed/reported、校正、弱点処方 |
| 5 | Safari / WebKit 信頼性 | PLANNED | iPhoneを含むブラウザ境界の最小回帰 |
| 6 | 教材・練習モード・記譜・音源の拡張 | PLANNED | 同一素材の分解練習UI、能力ID教材、複声部等 |
| 7 | 音源取込・分離・自動採譜 | FUTURE | Import / Analysis pipeline |

---

## 2. Phase 0 — 配信・再生・譜面基盤

**状態: DONE**

到達済み:

- 基礎・フレーズ・リズムの3モード統合
- 教材JSONと表示ロジックの分離
- VexFlow / Bravura による五線譜 + TAB
- 付点・連符・タイ・スラー・ベンド・スライド・H/P等の記譜モデル
- ナイロンギター、ベース、ドラムのサンプル再生
- Service Workerによるオフライン動作
- 単体テスト、データ検証、Playwright E2E
- AudioContext時刻へ予約する先読み再生

以後は既存基盤として扱い、このPhaseへ戻って作り直しません。

---

## 3. Phase 1 — 集中練習ループ

**状態: DONE — PR #11**

到達済み:

- 小節単位の選択区間
- 1小節 / 2小節 / 全体反復
- 予備拍
- Assist Fade（音名なし / 五線譜のみ / 暗譜）
- お手本メロディON/OFF
- 練習条件付きAttempt
- 再生完了と自己申告の分離
- STOP時の予約済みAudioNode取消
- 遅延ロードされた古い再生要求の破棄

ここで「条件を固定して反復し、結果を残す」最小ループが成立しました。

---

## 4. Phase 2 — 共通時間基盤

**状態: DONE — PR #12**

`guitar.js` と `phrase.js` の先読みスケジューラを `core/clock.js` へ集約しました。

不変条件:

- `AudioContext.currentTime` を発音時刻の基準とする
- `setInterval` / `setTimeout` から直接発音しない
- lookahead は 0.15 秒
- `core/clock.js` はブラウザグローバルを直接参照しない
- 音符・小節・ループ・Attempt状態をclockへ持ち込まない

詳細: `TASK-NEXT-CLOCK.md`

---

## 5. Phase 3 — 録音・自己モニタリング

**状態: DONE — PR #13**

目的:

スマートフォンのマイクから演奏を録音し、同じ練習Attemptと対応付けて聴き返せるようにします。
最初から自動採点は行いません。

```text
練習条件
  ↓
録音しながら演奏
  ↓
停止
  ↓
録音を聴き返す
  ↓
ルーブリック自己評価
  ↓
Attempt保存
```

狙い:

- `ear.selfmonitor` を練習フローへ入れる
- 不要弦、粒、音色、フレージングを本人が確認できる
- Attemptと録音の関係を固定する
- 権限拒否・録音非対応でも通常練習を壊さない

詳細: `TASK-NEXT-RECORDING.md`

### Phase 3ではまだ入れないもの

次の「譜読み / リズム / 演奏 / 統合」の分解は設計として採用しますが、**Phase 3の実装へ混ぜません**。
録音機能を安定してmainへ入れることが先です。

---

## 6. Phase 4 — 診断・測定・処方基盤

**状態: CURRENT — Phase 4A**

目的:

「弾けない」を一つの失敗として扱わず、**どの処理系がボトルネックかを切り分ける**基盤を作ります。

### 6.1 設計原則 — 分解して習得し、再統合する

同じフレーズ・同じ小節区間を、次の4つのfocusで使い回します。

| focusMode | 主に扱う能力 | 意図的に軽くするもの |
|---|---|---|
| `reading` | 五線譜→音名・度数・指板位置の変換 | タイミング・音色・運動負荷 |
| `rhythm` | 拍、細分、アクセント、タイミング | 正しい音高 |
| `execution` | 運指、弦移動、左右同期、発音品質 | 初見・譜読み負荷 |
| `integrated` | 音高 + リズム + 奏法 + 読譜の統合 | なし |

最終能力は `integrated` ですが、練習途中は分解します。

```text
integrated で失敗
  ↓
reading / rhythm / execution を同一素材で確認
  ↓
弱いfocusだけ練習
  ↓
integratedへ戻す
```

### 6.2 教材を4倍にしない

4種類の別教材は作りません。

```text
phraseId: 同じ
range:    同じ
focusMode: reading | rhythm | execution | integrated
```

**1つのフレーズ × 4つの練習focus** として扱います。
教材JSONの音符列や小節構造を複製しないことを原則とします。

### 6.3 AttemptへfocusModeを追加する

Phase 4の最初に `focusMode` を練習条件の一部として導入します。

例:

```text
phraseId: a7-blues-01
range: M3-M4
tempo: 80
assist: staff
focusMode: rhythm
```

同じphrase/rangeでもfocusが違えば別条件です。
`rhythm` 成功を `integrated` 成功として扱ってはいけません。

既存Attemptとの互換性を保つため、古い記録は migration / normalization 時に `integrated` 相当として扱う方針を明示してから実装します。

### 6.4 Phase 4の内部順序

**Phase 4A — 診断focusモデル**

- `focusMode` のスキーマ
- Attempt条件への保存
- 同じphrase/rangeをfocus別に比較できる集計
- 既存Attempt互換
- まだ4つの豪華な専用画面は作らない

詳細: `TASK-NEXT-DIAGNOSTIC-FOCUS.md`

**Phase 4B — 測定意味論と校正**

- Tier A / `measured`: タイミング、単音ピッチ、RMS、完遂率等
- Tier B / `observed`: 録音・外部観察で得る事実
- Tier C / `reported`: 本人の自己評価・感覚
- 入出力レイテンシ校正
- accuracy（偏り）と precision（ばらつき）の分離

**Phase 4C — 処方**

同じ素材のfocus別結果から次の練習を提案します。

例:

- readingのみ失敗 → 音名 / 度数 / 指板対応へ戻す
- rhythmのみ失敗 → 単一音・ミュート・口唱歌相当の課題へ戻す
- executionのみ失敗 → 譜読み負荷を落として運指 / 弦移動 / 同期へ戻す
- 3focus成功・integrated失敗 → 統合負荷そのものを練習する

処方は「総合点が低い」ではなく、**どこが弱いか**を返す設計にします。

### 6.5 測定の禁止事項

- 校正なしのタイミング値を成績として保存しない
- 自己申告をmeasuredへ昇格させない
- 4focusを一つの総合スコアへ潰さない
- reading成功だけで演奏能力が上がったと判定しない

---

## 7. Phase 5 — Safari / WebKit 信頼性

**状態: PLANNED**

Chromiumだけではスマートフォン実運用の保証として不足するため、WebKitで最小smoke suiteを持ちます。

対象:

- 起動
- フレーズ読込
- 譜面描画
- AudioContext再生開始 / 停止
- マイク録音開始 / 停止
- IndexedDB保存
- Service Worker / オフライン復帰

全E2Eを二重化せず、Web Audio・MediaRecorder・IndexedDB・PWA境界を重点的に守ります。

---

## 8. Phase 6 — 教材・練習モード・記譜・音源の拡張

**状態: PLANNED**

Phase 4でfocusModeのデータモデルと診断を成立させた後、4focusを専用練習UXへ展開します。

### 8.1 同じ素材を4focusで使う

専用ページを4つ複製するのではなく、同じphraseモデルへ練習方法を適用します。

- `reading`: 音名・度数・指板位置を答える。楽器なしでも成立できる
- `rhythm`: 音高を中立化し、手拍子・口唱歌・ミュート弦相当でリズムだけ扱う
- `execution`: 覚えた短区間を使い、譜読み負荷を下げて運指・ピッキングへ集中する
- `integrated`: 通常の譜面・音高・リズム・奏法をまとめて演奏する

UIの違いはfocusの責務として実装し、教材固有のJavaScript分岐にしません。

### 8.2 教材

能力IDと結び付けて増やします。

- 弦移動
- ハイブリッドピッキング
- クロマチック / ポジション移動
- コードトーン
- 16分アクセント / 3連
- 低音 + 旋律
- 初見
- 暗譜と途中小節からの再開

### 8.3 記譜

特殊奏法を増やす前に構造上の不足を埋めます。

1. 休符
2. 複声部
3. フレーズ側の任意拍子

特にフィンガースタイルでは低音と旋律が別の長さで進むため、複声部が重要です。

### 8.4 音源

- ファイル自体はオフライン用にキャッシュ
- decodeは必要な音域・奏法だけ遅延実行
- 全奏法・全ベロシティを初回にdecodeしない

---

## 9. Phase 7 — 音源取込・パート分離・自動採譜

**状態: FUTURE**

練習プレイヤー内部へ直接押し込まず、独立した Import / Analysis pipeline とします。

```text
音源ファイル
  ↓
stem separation
  ↓
ギターパート
  ↓
onset / pitch / polyphonic transcription
  ↓
中間ノートモデル
  ↓
人間による修正
  ↓
phrases.json / MusicXML
```

自動採譜結果を無検証で教材へ公開しません。
既存の音名 / TAB / 記譜バリデータを最終ゲートとして再利用します。

---

## 10. 優先順位の判断基準

新機能案は次の順で評価します。

1. 現在Phaseの完了条件に必要か
2. 練習のフィードバックループを閉じるか
3. 時間・記録・測定の信頼性を上げるか
4. 実際のギター技能の弱点を切り分けられるか
5. 同じ教材を再利用できるか
6. 教材追加時にコード分岐を増やさないか
7. オフライン・静的配信・モバイル利用を壊さないか

「見た目が豪華になる」「機能数が増える」だけではPhaseを飛ばしません。

---

## 11. 非目標

当面、次は行いません。

- フレームワーク / TypeScript / バンドラ導入
- サーバー必須化
- 校正なしの精密タイミング採点
- 自己申告と自動測定を同じスコアとして表示
- 4focusを単一の総合点へ潰すこと
- 4focusごとに教材JSONを複製すること
- 自動採譜結果の無検証公開
- 教材固有ロジックのJavaScriptへの埋め込み
- Current Phaseを更新せずに次段階の機能を混ぜること
