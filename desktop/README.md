# Enterprise Corpus Electron base

Corpus server、Web UI、企業用 plugin pack、SQLite native module を1つの Electron
配布物へまとめるためのベースです。Electron の画面、HTTP API、Skill、MCP は
server に登録された同じ Capability handler を呼びます。

## 企業別に変更する箇所

各キーの責務境界は `spec/feature/desktop-runtime.md` にある。

`corpus.desktop.json`:

```json
{
  "productName": "Example Corp Hub",
  "serviceId": "example-corp-hub",
  "pluginPack": "examples/corp-hub",
  "noAuth": true,
  "updateBaseUrl": "https://updates.example.com/example-corp-hub"
}
```

- `productName`: ウィンドウ、トレイ、配布物の表示名
- `serviceId`: サービス識別子と実行ファイル名
- `pluginPack`: bundled runtime 内の plugin pack 相対パス
- `noAuth`: ローカル専用サンプルだけ `true`。企業配布では Cernere 設定と共に
  `false` にする
- `updateBaseUrl`: 省略時は更新確認なし。指定すると
  `<base>/<platform>/<arch>` の Squirrel/ZIP 更新メタデータを使って自動更新する

企業固有のデータ・スキーマ・Capability は派生 plugin pack に置き、Corpus 本体へ
入れません。

## ビルド

```sh
npm install
npm run package
```

生成物は `dist/<Product Name>-<platform>-<arch>/` に出ます。`build-runtime.mjs` が
server と plugin entry を共通 chunk へ bundle するため、Hono や SDK の二重ロードを
避けられます。`better-sqlite3` は Forge が対象 Electron ABI 用に再構築し、asar から
自動展開します。

アプリの実起動テストはリポジトリの運用規約に従い、Excubitor 管理下のプロジェクト
本体フォルダで行ってください。

## Skill / MCP

`../integrations/plugins/enterprise-corpus` を Codex plugin として配布できます。
接続時は次を設定します。

```text
CORPUS_BASE_URL=<起動中のアプリが公開する loopback URL>
CORPUS_ACCESS_TOKEN=<Cernere 認証を使う場合だけ>
```

Skill の CLI と MCP proxy はいずれも Corpus server の共通 Capability endpoint を
使います。企業ロジックを Skill 側へ複製しないでください。
