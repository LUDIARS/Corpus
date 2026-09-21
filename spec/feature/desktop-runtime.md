# デスクトップ配布物の寿命と再ブランド

Electron 外殻の責務境界。概要は `DESIGN.md` §10、企業別の設定手順は `desktop/README.md`。
Corpus server・Web UI・plugin pack・native module を 1 つの配布物にまとめ、
その寿命を所有する。業務ロジックは plugin pack 側に残す。

## 設定

`desktop/corpus.desktop.json` が企業別に変わる唯一の面。`desktop/src/config.ts` が読む。

| キー | 役割 |
|---|---|
| `productName` | ウィンドウ / トレイ / 配布物の表示名、`CORPUS_DISPLAY_NAME` |
| `serviceId` | サービス識別子と実行ファイル名、`CORPUS_SERVICE_ID` |
| `pluginPack` | bundled runtime 内の plugin pack 相対パス、`CORPUS_PLUGIN_DIR` |
| `noAuth` | ローカル専用サンプルのみ `true`。`CORPUS_NO_AUTH` |
| `updateBaseUrl` | 省略時は更新確認なし |

`loadDesktopConfig` は既定値へ無言フォールバックしない。既定に `noAuth` を含めると
設定の同梱漏れがそのまま「認証 bypass で起動」になるため、見つからなければ落とす。
探索順は `CORPUS_DESKTOP_CONFIG` → `resourcesPath` → `appPath`。

## プロセス

`desktop/src/server-process.ts` の `EmbeddedCorpusServer` が内蔵 server を所有する。

- port は `CORPUS_PORT` 指定が無ければ loopback の空き port を予約する。
- `process.execPath` を `ELECTRON_RUN_AS_NODE=1` で起動し、data dir は
  `app.getPath('userData')`。リポジトリの cwd に依存しない。
- `waitUntilReady()` は `/api/health` が返るまで待つ。起動できなくてもウィンドウは
  出し、理由を画面に表示する。
- 起動した所有者が止める。設定不備・起動失敗・`before-quit` のいずれでも `stop()` を
  通り、窓もトレイも出ないまま unhandled rejection で終わらない。

## ビルド

`desktop/scripts/build-runtime.mjs` が `server/bootstrap.ts` と pack の module entry を
1 つの esbuild グラフへ bundle する (`splitting: true`)。Hono と hub SDK を共有 chunk に
載せるのが目的で、別々に bundle すると `app.route()` が壊れる二重ロードを再現してしまう。
`pluginPack` がリポジトリ外を指す設定は拒否する。`better-sqlite3` だけ external に残し、
Electron Forge が対象 ABI 向けに再構築する。

## 維持する振る舞い

- 配布物の server と plugin entry は 1 つの bundle 済み依存集合を共有する。
- 設定不備は報告してアプリを終了させる。既定値で起動を続けない。
- 更新エンドポイントは `updateBaseUrl` があり、かつ packaged build のときだけ叩く。
