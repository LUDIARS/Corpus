# corp-hub — 企業用 Hub のテンプレート

社内向け Hub (1 Hub = 1 社) を Corpus 上に作るための **プラグインパック雛形**。
そのまま動かせるモックアップであり、派生リポの出発点でもある。

Corpus 本体はドメインを持たないため、このパックは `examples/` 配下に置かれ
**既定ではロードされない**。`CORPUS_PLUGIN_DIR` で明示的に指すと有効になる。

---

## 収録モジュール — プラグインの 3 類型

| id | 類型 | 何を示すか |
|---|---|---|
| `announcements` | **自前データ** | Hub の SQLite だけで完結する CRUD。 admin 制限・入力検証・`registerData` |
| `directory` | **Cernere 正本** | 個人データを Hub に複製しない線引き。 external-id と表示名キャッシュだけ持つ。 admin には「90 日ログインなし」の棚卸し候補も出す |
| `facility` | **外部コネクタ** | Aedilis への中継。 `tokenProvider` 経由の参照先トークン発行と degraded 動作 |

ドメイン機能を足すときは、この 3 類型のどれに当たるかを決めてから書く。

---

## 動かす

```bash
npm install
npm run build:web             # Corpus shell
npm run build:example-panels  # このパックの panel.js を生成
CORPUS_PLUGIN_DIR=examples/corp-hub npm run dev
```

| env | 役割 |
|---|---|
| `CORPUS_PLUGIN_DIR` | `examples/corp-hub` (これを指すと有効になる) |
| `CORP_HUB_AEDILIS_URL` | 施設モジュールの接続先。 **未設定なら未接続表示で動く** |
| `CORP_HUB_AEDILIS_PROJECT_KEY` | 参照先トークン発行に使う Cernere project key (既定 `aedilis`) |

Corpus 本体の必須 env (`CERNERE_BASE_URL` / `CORPUS_TOKEN_MODE` など) は
リポジトリ root の README を参照。

---

## 認証 — Cloudflare Access バイパスを使う場合

企業用 Hub は **Cloudflare Access で認証し、それを Cernere へ引き渡す**構成を想定する
(`DESIGN.md` §16、Cernere `spec/feature/edge-assertion-login.md`)。

```bash
CORPUS_AUTH_MODE=edge
CORPUS_EDGE_TEAM_DOMAIN=<team>.cloudflareaccess.com
CORPUS_EDGE_AUD=<Access Application の AUD tag>
```

この構成では Hub にログイン画面が無く、CF Access を抜けた時点で認証済みになる。
**Hub の origin は cloudflared トンネル経由でしか到達できないようにすること**
(直接到達できるとヘッダ偽装で成りすませる)。

`CORPUS_AUTH_MODE=edge` は現時点で **Proposed**。実装が入るまではローカル開発用に
`CORPUS_AUTH_MODE=composite` (Cernere 埋め込みログイン) で動かす。

---

## モジュールを足す

1. `examples/corp-hub/<id>/index.ts` に `CorpusModule` を default export する
2. 画面が要るなら `<id>/panel.ts` に `mount(container, ctx)` を書く
3. `pack.json` の `modules` に `<id>` を足す
4. `package.json` の `build:example-panels` に panel.ts を足す
5. `npm run typecheck && npm run build:example-panels`

**ランタイム import は必ず `server/hub/sdk.ts` 経由**にする。`hono` を直接 import すると
別コピーを掴んで二重ロードになり `app.route()` が壊れる。

DB スキーマは `data.ts` に集約する (定義がモジュール間に散らないように)。

---

## 派生リポへ持ち上げる (EducationLab 方式)

社内向けに本番運用するなら、このパックを別リポへ移して Corpus を submodule で取り込む。

```bash
mkdir <Name>Hub && cd <Name>Hub && git init
git submodule add https://github.com/LUDIARS/Corpus corpus
cp -r <corpus>/examples/corp-hub/* plugins/
```

移したあとに直すのは 2 点だけ:

1. import パス — `../../../server/hub/sdk.ts` → `../../corpus/server/hub/sdk.ts`
   (パネルの `../../public/src/types.ts` → `../../corpus/public/src/types.ts`)
2. `server.ts` を置いて `CORPUS_PLUGIN_DIR=plugins` で Corpus を起動する

先行例は VGA-EducationLab/EducationLab (学校向け Hub)。`corpus/` submodule は触らず、Corpus 本体への
変更は LUDIARS/Corpus 側で PR を出して submodule pointer を上げる運用にする。
