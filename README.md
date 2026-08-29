# 指弾きギター練習帖

スマートフォンで毎日10分の指弾き練習を開くための、静的HTMLアプリです。

- アプリ：`index.html`
- 教材索引：`data/lessons-index.json`
- 各課：`data/lessons/NNN.json`
- 交換用譜面：`musicxml/NNN-*.musicxml`
- 検証：`npm test`

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
python3 -m http.server 8000
```

その後 `http://localhost:8000/` を開きます。`file://` では教材JSONを読み込めないため、簡易Webサーバーを使用してください。


## 統合練習モード

GitHub Pages 上のアプリは3モードで構成します。

- **基礎**: 従来の10分Lesson。右手運指、親指独立、アルペジオなどを段階的に練習
- **フレーズ**: 五線譜 + TAB + Web Audio。再生、停止、テンポ変更、ループ、一音確認に対応
- **リズム**: 口・右手・左手・足の独立トレーニングを同じPagesアプリへ統合

### 音の鳴るフレーズ教材

- 教材データ: `data/phrases.json`
- 画面: `phrase.html`
- 再生・譜面同期: `phrase.js`
- 検証: `scripts/validate-phrases.mjs`

初期教材には、開放弦 i–m、3→2→1→2 弦またぎ、Cメジャー往復、1弦 5–8–10 を収録しています。
フレーズはJSONへ追加でき、音名・弦・フレット・音価・右手指を検証してから公開できます。
