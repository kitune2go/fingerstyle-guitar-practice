このリポジトリの規約は [`AGENTS.md`](../AGENTS.md) に集約されています。作業前に読んでください。

特に重要な3点:

- ビルド工程を持たない静的サイトです。バンドラ・TypeScript・フレームワークを導入しないでください
- 発音のタイミングは常に `AudioContext.currentTime` 基準。`setInterval` で音を鳴らさないでください
- ローカルアセットを追加したら `sw.js` の `APP_SHELL` に登録し、`CACHE_NAME` を上げてください
