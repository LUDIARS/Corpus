# Corpus — Claude 向けメモ

## 性格

汎用 **hub フレームワーク**。 ドメイン (学校・社内 等) を **持たない**。
ドメイン機能はプラグインパック側 (VantanHub 等) に置く。 Corpus 本体に
学校固有のコードを足してはいけない。

## 触ってよい / よくない

- 触ってよい: `server/`, `public/`, `desktop/`, `tsconfig*`, `package.json`, README
- 触らない: 他リポ。 Corpus は単独完結
- DB schema 変更は migration を別途用意 (現状 `CREATE IF NOT EXISTS` のみ)。
  新規カラム用 INDEX は ALTER ADD COLUMN の直後に冪等発行する

## アーキ要点

- Hono + better-sqlite3 + esbuild + tsx (Bibliotheca / Memoria pattern)
- Cernere PASETO V4 検証は `server/auth.ts` (公開鍵 6h 毎 refresh)
- 起動口は `server/bootstrap.ts`: Infisical machine identity →
  `ensureEnv()` で secret fetch & inject → `index.ts`
- hub 機構は `server/hub/`: コネクタ抽象 + レジストリ + プラグインローダ
- v0.2 データハブ機構 (横断仕様 `../VantanHub-DESIGN.md` §7-9):
  - `hub/manifest.ts` — サービスマニフェスト `/.well-known/corpus-service.json` (D6)
  - `hub/discovery.ts` — local 既知ポート probe / server 設定参照 (D1)
  - `hub/tokens.ts` — 参照先トークン伝播の抽象 (passthrough / cernere-project-token、D5)
  - `connectors/manifest-connector.ts` — マニフェスト駆動コネクタ
  - `/api/hub/services` (一覧) / `/api/hub/data/:service/:dataId` (集約取得)
- frontend (`public/`) は shell のみ。 ドメイン UI はプラグインの `panel.js`

## プラグインパックを足すとき

Corpus 本体は変更しない。 別リポ (VantanHub 等) で:

1. プラグインパックのルートディレクトリを用意
2. 各モジュールを `<dir>/<moduleId>/index.ts` に置き `CorpusModule` を default export
3. Corpus を `CORPUS_PLUGIN_DIR=<dir>` で起動

**プラグインのランタイム import は必ず `server/hub/sdk.ts` 経由にする。**
直接 `hono` を import するとプラグイン側 node_modules の別コピーを掴み、
hono が二重ロードされて `app.route()` が壊れる。 sdk.ts は Corpus 側の
単一コピーを再エクスポートする。

## やらないこと

- ドメイン固有モジュール (= プラグインパック側)
- ユーザ登録 UI (Cernere 側)
- 通知配信そのもの (プラグイン or Nuntius 側。 Corpus は土台のみ)

## テスト方針

- v0.1 は手動 (`npm run dev` → ブラウザ → 認証 → タブ表示)
- 後で vitest で auth と hub registry の最小ケースを書く
