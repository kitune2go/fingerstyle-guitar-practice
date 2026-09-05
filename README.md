# 指弾きギター練習帖

スマートフォンで毎日10分の指弾き練習を開くための、静的HTMLアプリです。

- アプリ：`index.html`
- 教材索引：`data/lessons-index.json`
- 各課：`data/lessons/NNN.json`
- 交換用譜面：`musicxml/NNN-*.musicxml`
- データ検証：`npm test`
- ブラウザ検証：`npm run test:e2e`（Playwright。ローカルサーバーは自動起動します）

## スマートフォンで開く

GitHub Pagesを有効にすると、次のURLから開けます。

```text
https://kitune2go.github.io/fingerstyle-guitar-practice/
```

GitHubの `Settings` → `Pages` → `Deploy from a branch` で、`main` と `/(root)` を選択します。

ChromeまたはSafariの「ホーム画面に追加」を使うと、通常のアプリに近い形で起動できます。練習の完了状態は端末内に保存されます。

## 教材を追加する手順

1. `data/lessons/NNN.json` を1件作成する
2. 必要に応じて `musicxml/NNN-*.musicxml` を作成する
3. `data/lessons-index.json` の末尾へ登録する
4. `npm test` を実行する
5. `main` へコミットする

ファイルを作るだけではアプリに表示されません。必ず索引へ登録してください。

## 文書

| 文書 | 内容 |
|---|---|
| [`AGENTS.md`](AGENTS.md) | **コードを書く前に必読。** 全作業に共通する規約・検証手順・既知の制約 |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | 長期設計。能力モデル、測定の3階層、実装フェーズ |
| [`docs/TASK-P0.md`](docs/TASK-P0.md) | 現在の実装タスク（エンジン層の抽出）の詳細仕様 |

`AGENTS.md` は特定のAIサービスに依存しない形式です。人間・自動エージェントを問わず、
このリポジトリで作業する全員が対象です。

## 段階カリキュラム

1. i–m交互運指
2. 親指pの独立
3. p–i–m–aアルペジオ
4. コードチェンジを伴う分散和音
5. 低音と旋律の分離
6. リズム・アクセント
7. 指板上のスケール
8. コードトーンと旋律
9. 短いオリジナル練習曲

一課では主題を一つに絞り、過去課の要素は復習としてのみ使います。

## 自動追加時の必須条件

- `id` は3桁の連番とし、既存IDを再利用しない
- `routine[].minutes` の合計を `durationMinutes` と一致させる
- TABは上から `e / B / G / D / A / E` の順にする
- 右手運指とTABの音数を照合する
- 次回予告を実際のカリキュラム順と一致させる
- 既存ファイルを上書きせず、索引は末尾に一件だけ追加する
- 検証に失敗した状態ではコミットしない

## ローカル確認

```bash
npm run serve
```

その後 `http://localhost:8000/` を開きます。`file://` では教材JSONを読み込めないうえ、Service Workerも登録できないため、必ず簡易Webサーバーを使用してください。


## 統合練習モード

GitHub Pages 上のアプリは3モードで構成します。

- **基礎**: 従来の10分Lesson。右手運指、親指独立、アルペジオなどを段階的に練習
- **フレーズ**: 五線譜 + TAB + Web Audio。再生、停止、テンポ変更、ループ、一音確認に対応
- **リズム**: 口・右手・左手・足の独立トレーニングを同じPagesアプリへ統合

リズム画面は `rhythm.html` を薄い画面シェルとし、`rhythm.js` が `rhythm/` 以下のパターンモデル、音声、先読みスケジューラ、表示時計、Ghost、Grid、Orbitを組み合わせます。拍子・小節数・細分はパターン定義から導出されます。

### 音色モード

3モード共通の「音色」ボタンで、既定のリアル音源と軽量な合成音を切り替えられます。選択は端末内に保存され、別の練習モードへ移動しても引き継がれます。

- **基礎**: ハイハットと小節頭のタムによるメトロノーム
- **フレーズ**: ナイロンギター、エレキベース、アコースティックドラム
- **リズム**: Voice＝タム、R.Hand＝ハイハット、L.Hand＝スネア、Foot＝キック

サンプルを読み込めない場合は、該当音だけ従来の合成音へ自動的にフォールバックします。音源はService Workerが事前キャッシュするため、初回キャッシュ完了後はオフラインでも利用できます。出典とライセンスは [`audio-credits.html`](audio-credits.html) に記載しています。

### 音の鳴るフレーズ教材

- 教材データ: `data/phrases.json`
- 画面: `phrase.html`
- 再生・譜面同期: `phrase.js` / `core/music.js` / `core/notation.js`
- 検証: `scripts/validate-phrases.mjs`

初期教材には、開放弦 i–m、3→2→1→2 弦またぎ、Cメジャー往復、1弦 5–8–10、A7ブルースを収録しています。
フレーズはJSONへ追加でき、音名・弦・フレット・記譜音価・実時間の長さ・連符・特殊奏法・右手指を検証してから公開できます。

### フレーズ追加時の制約

- `key` は `core/music.js` の `SUPPORTED_KEYS` に載っている調のみ（`validate-phrases.mjs` が拒否します）
- 調号に含まれる音には臨時記号を書かない。譜面側が自動で判断します
- 普通の音価は全音符から32分音符まで。付点は `notated.dots`、連符は `timeModification` と表示用 `tuplets` を分けて記述します
- タイ、スラー、H/P、スライド、ベンド、ハーモニクス、ビブラート、パームミュートは `phrase.notations` に関係として記述します
- 五線譜と標準TABは同梱の VexFlow / Bravura で描画し、初回キャッシュ完了後はオフラインでも表示します

## オフライン動作

`sw.js` がアプリ本体・同梱サンプル音源・`data/phrases.json`・`data/lessons-index.json`、および索引に載っている全レッスンJSONを事前キャッシュします。
レッスンを追加した場合は `sw.js` の `CACHE_NAME` を上げてください（索引経由で拾うので、ファイル名の列挙は不要です）。
