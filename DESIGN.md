# Corpus — 設計書 (draft v0.1)

> 名の由来: ラテン語 **corpus** — 「身体・全体・集合体・団体」。 散在する LUDIARS
> 各サービスを一つの身体としてまとめて見せる hub という性格に一致する。

LUDIARS の **hub サービス**。 元は Memoria の Hub 機能 (データハブ + Hub Shell、
PR #172) だったが、 2026-05-21 に独立サービスとして切り出すことが決定した。
Memoria 本体はローカルログ / 個人ナレッジ専用に残り、 hub 機能が Corpus になる。

Corpus 単体は「特定ドメインを持たない汎用 hub フレームワーク」 である。
学校・社内・家庭など、 用途特化の hub は **Corpus を submodule で取り込み、
プラグインパックを載せて** 作る (第一号が VantanHub)。

短縮コード案: **Co** (PROJECT-CODES.md への登録は実装フェーズで)
リポ: `E:\Document\Ars\Corpus\` / `LUDIARS/Corpus`

---

## 1. 目的とスコープ

### 1.1 目的

- 複数の LUDIARS サービスを **一画面に集約** して見せる
- ローカル (この PC で動くサービス) と マルチ (サーバ経由で集約) を **区別表示** する
- 用途特化 hub の **共通土台** となる (プラグインパックで拡張)

### 1.2 スコープ内 (v0.1)

- Cernere SSO による認証
- サービスコネクタの抽象 (`ServiceConnector`) と レジストリ
- プラグインパック機構 (`CORPUS_PLUGIN_DIR` から動的ロード)
- hub frontend shell (タブ + 動的パネルロード)
- サーバサイドアプリ (Hono、 frontend 配信 + 集約 API)
- ローカルアプリ (Electron、 純クライアント。 ローカルサービスへ直結)

### 1.3 スコープ外 (v0.1)

- ドメイン固有モジュール (= プラグインパック側、 例: VantanHub)
- 「最小送信」 のための専用通信ロジック (Corpus memo の "専用ロジック"。
  v0.1 は通常の REST 集約。 圧縮プロトコルは将来課題)
- モバイルアプリ (ローカルアプリと同パターンで後追い、 v0.x)
- external-id の発行/再割り当て管理 UI (§7 参照、 設計のみ)

---

## 2. 既存サービスとの境界

| サービス | 関係 |
|---|---|
| **Memoria** | Hub 機能の出自。 Memoria 本体はローカルログ専用に残り、 Corpus はそのコネクタ越しに Memoria 情報を取り込む。 |
| **Cernere** | 認証。 PASETO V4。 「Cernere からサービス情報をもらう」 旧 hub 設計は破棄 — 各サービス自前のコネクタ実装に置換。 |
| **各 LUDIARS サービス** | Corpus はマルチハブ用のコネクタ経由でバックエンドに接続。 サービス側は専用エンドポイント (multi-hub Web-UI backend) を公開する。 |
| **VantanHub** | Corpus を submodule で取り込み、 学校特化プラグインパックを載せた派生 hub。 Corpus の最初の利用者。 |

---

## 3. アーキテクチャ

Corpus は **2 つのランタイム** を持つ。 frontend (`public/`) は両者で共有する。

```
┌────────────────────────┐        ┌────────────────────────┐
│ ローカルアプリ (Electron) │        │ サーバサイドアプリ (Hono) │
│  - 純クライアント         │        │  - frontend を配信        │
│  - 同 PC の Corpus server │ ─────▶ │  - マルチ情報を集約        │
│    を子プロセス起動       │ multi  │  - 外部公開する hub        │
│  - ローカルサービスへ直結  │        │                          │
└───────────┬────────────┘        └───────────┬────────────┘
            │ local                            │
   ┌────────▼─────────┐              ┌─────────▼──────────┐
   │ 同 PC のサービス    │              │ 各サービスの multi   │
   │ (loopback 17xxx)  │              │ -hub backend        │
   └──────────────────┘              └────────────────────┘
```

- **サーバサイドアプリ** = 外部公開する hub。 Memoria が :5180 を公開するのと同様。
- **ローカルアプリ** = 外部公開 web フロントを持たない純クライアント。
  - ローカル情報: ローカルアプリが各ローカルサービスへ **直接接続** して取得。
  - マルチ情報: サーバサイドアプリ経由で集約。
- frontend は同じ `public/` を両方がレンダリングする (Web で完結)。

### 3.1 ディレクトリ構成

```
Corpus/
├── DESIGN.md / README.md / CLAUDE.md
├── package.json / tsconfig*.json / .env.example / env-cli.config.ts
├── data/                      # SQLite (gitignore)
├── server/
│   ├── bootstrap.ts           # Infisical bootstrap → index.ts
│   ├── index.ts               # Hono app 起動
│   ├── auth.ts                # Cernere PASETO V4 検証
│   ├── db.ts                  # better-sqlite3 + migrations
│   ├── lib/env-bootstrap.ts   # Infisical secret fetch
│   ├── hub/
│   │   ├── types.ts           # ServiceConnector / CorpusModule / CorpusContext
│   │   ├── registry.ts        # レジストリ + プラグインパックロード
│   │   └── aggregate.ts       # local/multi 集約ロジック
│   ├── connectors/
│   │   └── builtin.ts         # 組み込みコネクタ (health / self)
│   └── routes/
│       ├── hub.ts             # /api/hub/*
│       └── me.ts              # /api/me
├── public/                    # frontend shell (vanilla TS + esbuild)
│   ├── index.html / style.css
│   └── src/{app,api,types}.ts
└── desktop/                   # Electron ローカルアプリ shell
    ├── package.json / tsconfig.json
    └── src/{main,preload}.ts
```

---

## 4. コネクタ機構

各 LUDIARS サービスへの接続は `ServiceConnector` で抽象する。

```ts
interface ServiceConnector {
  id: string;                       // 'memoria' / 'aedilis' ...
  title: string;
  /** この接続がローカルサービス由来かマルチ集約由来か */
  scope: 'local' | 'multi';
  /** 到達性チェック */
  health(): Promise<ConnectorHealth>;
  /** hub 表示用データの取得 (パネルが叩く) */
  fetch(path: string, init?: RequestInit): Promise<Response>;
}
```

- コネクタは「サービスの multi-hub backend を叩く HTTP クライアント」 に徹する。
- `scope` により frontend がローカル印 / マルチ印を出し分ける。
- 接続先サービスが未稼働でも `health()` が `down` を返すだけで Corpus は起動する
  (= 段階的に各サービスが立ち上がる前提)。

---

## 5. プラグインパック機構

Corpus 本体はドメインを持たない。 用途特化の機能は **プラグインパック** で足す。
ergo の `ERGO_PLUGIN_DIR` 方式 ([[feedback_ergo_editor_plugin_pack]]) と同じ思想。

- 起動時に `CORPUS_PLUGIN_DIR` を読む。 配下の各サブディレクトリが 1 モジュール。
- 各モジュールは `index.ts` から `CorpusModule` を default export する。
- モジュールは `CorpusContext` を受け取り、 以下を登録できる:
  - **connector**: `ServiceConnector` を追加
  - **route**: `/api/x/<moduleId>/...` に Hono サブルータを mount
  - **panel**: hub frontend のタブ (`panel.js` を静的配信、 frontend が動的 import)
- モジュール一覧は `GET /api/hub/modules` で配信。 frontend shell がそれを見て
  タブを描き、 各タブの `panel.js` を `import()` する。

```ts
interface CorpusModule {
  id: string;
  title: string;
  icon?: string;
  setup(ctx: CorpusContext): void | Promise<void>;
}

interface CorpusContext {
  db: Database;
  registerConnector(c: ServiceConnector): void;
  registerRoute(sub: Hono): void;        // /api/x/<moduleId> に mount される
  registerPanel(p: PanelDescriptor): void;
  env(key: string): string | undefined;
  logger: Logger;
}
```

VantanHub はこの仕組みで presence / facility / curriculum / schedule / chat-help
の 5 モジュールを載せる。

---

## 6. データスキーマ (SQLite, v0.1)

Corpus 本体が持つテーブルは最小。 ドメインデータはプラグインパックが
自分のテーブルを `ctx.db` 上に `CREATE IF NOT EXISTS` で足す。

```sql
-- userId → display name キャッシュ (Cernere が source of truth)
CREATE TABLE IF NOT EXISTS user_display_cache (
  user_id     TEXT PRIMARY KEY,   -- external-id (§7)
  name        TEXT NOT NULL,
  updated_at  INTEGER NOT NULL
);

-- 接続済みサービスの最後の health スナップショット
CREATE TABLE IF NOT EXISTS connector_health (
  connector_id TEXT PRIMARY KEY,
  scope        TEXT NOT NULL,      -- 'local' | 'multi'
  status       TEXT NOT NULL,      -- 'up' | 'down' | 'degraded'
  detail       TEXT,
  checked_at   INTEGER NOT NULL
);
```

migration は `CREATE IF NOT EXISTS` + ALTER 後付け方式
([[feedback_sqlite_create_index_after_alter]] — INDEX は ALTER の直後に冪等発行)。

---

## 7. external-id 規約 (Corpus memo より)

- 共有可能性のあるデータ型は owner 識別子 `external-id` を持つ。
- 値はデフォルト **NULL = 自分** (Memoria は Cernere 無しでも動くため)。
  hub へ共有する時のみ external-id を充填する。
- `external-id` は複数 Cernere インスタンスの情報を混在できる owner 識別子。
  生 `sub` ではなく UUID 状の再設計識別子 (管理者権限で再割り当て可能)。
  発行/管理を Cernere 側に置くか Corpus 側マッピング層に置くかは調整中。
- 表示名は Corpus 側でキャッシュ (`user_display_cache`)。 Cernere を
  source of truth に保ちつつ availability 用の cache とする。

---

## 8. API (v0.1)

すべて `/api/*`、 Cernere PASETO Bearer 必須 (`/api/health` を除く)。

| Method | Path | 役割 |
|---|---|---|
| GET | `/api/health`               | 死活 (認証不要) |
| GET | `/api/me`                   | 自分の identity |
| GET | `/api/hub/modules`          | ロード済モジュール一覧 (frontend が タブ描画) |
| GET | `/api/hub/connectors`       | コネクタ一覧 + 最新 health |
| GET | `/api/hub/overview`         | local/multi 区別つきの集約サマリ |
| ALL | `/api/x/<moduleId>/*`       | 各プラグインモジュールのサブルータ |

---

## 9. 起動と env

### 9.1 起動モード (Bibliotheca と同型)

`server/bootstrap.ts` が Infisical machine identity から secret を fetch +
inject してから `index.ts` を読む。 `.env` 直書き / Excubitor inject も可。

### 9.2 必須 / 主要 env

| Key | 役割 |
|---|---|
| `CERNERE_BASE_URL`   | Cernere 公開鍵 fetch |
| `CORPUS_PUBLIC_URL`  | PASETO audience |
| `CORPUS_ADMIN_IDS`   | admin の external-id (カンマ区切り) |
| `CORPUS_PLUGIN_DIR`  | プラグインパックのルート (未設定なら本体のみ) |
| `CORPUS_PORT`        | listen port |
| `CORPUS_DATA`        | SQLite 等のデータディレクトリ |
| `CORPUS_REMOTE_URL`  | ローカルアプリが叩くサーバサイドアプリ URL (マルチ情報用) |

### 9.3 ポート (暫定、 infra/PORT-MAP.md 登録は実装 PR で)

- サーバサイドアプリ: `5185` (Memoria 5180 の隣)
- ローカルアプリ内蔵 server: loopback `17520`

---

## 10. ローカルアプリ (Electron)

- Memoria desktop と同パターン: `electron` + TypeScript ラッパー。
- 起動時に Corpus server を子プロセス spawn (loopback 17520)、
  BrowserWindow で frontend を表示。
- 純クライアント — 外部公開 web フロントを持たない。
- タスクトレイ常駐 (close = hide)。
- ローカルサービスへ直結してローカル情報を取得、 `CORPUS_REMOTE_URL` 経由で
  マルチ情報を取得し、 frontend で区別表示する。
- 用途特化 hub (VantanHub 等) は、 この shell を出発点に
  マスコット表示や最前面通知などを足す。

---

## 11. セキュリティ / 個人データ

- 個人データは Cernere 単一情報源 ([[project_personal_data_rule]])。
- Corpus が保持するのは external-id と display name **キャッシュ** のみ。
- コネクタは接続先サービスの認可をそのまま尊重 (Corpus は再認可しない、
  ユーザの Bearer をそのまま transparently 中継する経路を基本とする)。

---

## 12. マイルストーン

| 版 | 内容 |
|---|---|
| **v0.0** | DESIGN.md 起草 |
| **v0.1 scaffold** ✅ | server / public / desktop の骨格 + Cernere 認証 + コネクタ/プラグイン機構 + `/api/health` |
| **v0.2 data hub** ✅ | サービスマニフェスト (D6) + discovery (D1) + トークン伝播抽象 (D5) + `/api/hub/{services,data}` + frontend のサービス/データ表示。 横断仕様 `VantanHub-DESIGN.md` §7-9 を実装 |
| **v0.3 desktop** | Electron ローカルアプリ + local/multi 区別表示 |
| **v0.4 polish** | external-id マッピング層 + Excubitor 登録 + README |
| **v1.0** | VantanHub が Corpus 上で動作する状態 |

---

## 13. 宣言的レンダリング (declarative panels)

> 2026-05-21 ユーザ決定。 現行の panel.js (micro-frontend) 方式に加え、
> サービスが UI を **JSON で宣言**し Corpus 内蔵レンダラが描く **宣言的
> レンダリング**へ軸足を移す。 サービスはフロント JS を書かない。

### 13.1 背景

現行 (D4) の panel は §4 manifest の `ManifestPanel.entry` = サービス配信の
`panel.js`。 panel.js は `mount(container, ctx)` を export する実 JS で、
サービスが frontend を書く必要がある (micro-frontend)。

宣言的レンダリングでは、 サービスは UI を **descriptor (JSON)** で宣言し、
Corpus の内蔵レンダラが Foundation UI で実描画する。 定型 UI (一覧 / フォーム /
詳細 等) はサービス JS ゼロになる。

### 13.2 panel の種別 (corpusApi 2)

`ManifestPanel` を `kind` 判別の discriminated union にする
(`corpusApi` を 1 → 2 に上げる):

| kind | 宣言 | 描画 | 位置づけ |
|---|---|---|---|
| `declarative` | `ui` (descriptor インライン) または `uiEndpoint` (descriptor を返す URL) | Corpus 内蔵レンダラ | **既定・本命** |
| `script` | `entry` (panel.js URL) | サービス JS の `mount()` | エスケープハッチ (移行期の保険) |

加えて descriptor 内に `custom` component (サービス配信 WC を mount) を持つ。
`script` / `custom` は **カメラスキャン等、 宣言で原理的に書けない UI** に限る。
declarative shift の例外であり、 通常サービスは declarative のみで完結する。

サービスは `declarative` panel で `ui` インラインと `uiEndpoint` の
どちらを使うかを **自分で固定**する (静的 UI はインライン、 動的生成は endpoint)。

### 13.3 UI descriptor スキーマ

descriptor は `Panel → Section[] → Component[]` の階層。

```jsonc
// PanelDescriptor — declarative panel の ui / uiEndpoint が返す本体
{
  "descriptorVersion": 1,
  "title": "施設予約",
  "sections": [
    { "title": "新規予約", "components": [ /* ComponentDescriptor */ ] }
  ]
}
```

### 13.4 ComponentDescriptor — 8 種

`type` で判別。 共通フィールド: `requires?: "admin"` (admin のみ表示・実行)。

**1. `list`** — dataSource の配列を card で並べる
```jsonc
{ "type": "list",
  "dataSource": "<manifest data id>", "itemsPath": "items", "itemKey": "id",
  "empty": "予約はありません",
  "item": {
    "title": "{facility_name}",
    "subtitle": "{start_at|datetime}–{end_at|time}",
    "body": "{purpose}", "meta": "{owner_display_name}",
    "actions": [ /* ActionDescriptor — 単発 API 呼び出し */ ],
    "edit": {                          // 任意 — item をインライン編集
      "dataId": "<data id>", "method": "PATCH", "params": { "id": "{id}" },
      "success": "更新しました",
      "fields": [ /* FormField — item の値で pre-fill される */ ] } } }
```
`item.actions` は単発 API (キャンセル等)。 `item.edit` を付けると item に
「編集」 アフォーダンスが出て、 item の値で pre-fill したフォームに切り替わり
PATCH する (一覧上のインライン編集)。

**2. `form`** — field 群 + submit
```jsonc
{ "type": "form",
  "submit": { "dataId": "<data id>", "method": "POST", "success": "予約しました" },
  "fields": [
    { "name": "facilityId", "label": "施設", "input": "select",
      "optionsSource": "<data id>", "optionsPath": "items",
      "optionLabel": "name", "optionValue": "id", "required": true,
      "optionDetail": [ { "label": "場所", "value": "{location}" },
                        { "label": "定員", "value": "{capacity}" } ] },
    { "name": "startAt", "label": "開始", "input": "datetime", "required": true },
    { "name": "purpose", "label": "目的", "input": "text", "maxLength": 200 } ] }
```
`input` 種: `text` / `textarea` / `number` / `select` / `datetime` / `date` / `checkbox`
- `select` は `options` (静的な固定 enum、 `{label,value}[]`) または
  `optionsSource` (data id から動的取得) で選択肢を与える
- `optionsSource` 利用時は `optionsPath` でレスポンス内の配列パス (例 `items`)、
  `optionLabel`/`optionValue` で表示/値フィールドを指定
- `optionDetail` を付けると、 選択中オプションのレコードから指定フィールドを
  フォーム内に表示する (optionsSource 利用時)

**3. `detail`** — 1 レコードの key-value
```jsonc
{ "type": "detail", "dataSource": "<data id>", "recordPath": "facility",
  "fields": [ { "label": "場所", "value": "{location}" },
              { "label": "定員", "value": "{capacity}" } ] }
```

**4. `table`** — 列定義 + 行データ
```jsonc
{ "type": "table", "dataSource": "<data id>", "itemsPath": "items",
  "columns": [ { "header": "施設", "value": "{facility_name}" },
               { "header": "時間", "value": "{start_at|datetime}" } ],
  "rowActions": [ /* ActionDescriptor */ ] }
```

**5. レイアウト (`section` / `tabs`)** — 入れ子コンテナ
```jsonc
{ "type": "section", "title": "...", "components": [ /* ... */ ] }
{ "type": "tabs", "tabs": [ { "label": "一覧", "components": [ /* ... */ ] } ] }
```

**6. `stat`** — 数値サマリ
```jsonc
{ "type": "stat", "label": "未完了", "dataSource": "<data id>", "value": "{count}" }
```
`value` 省略時は dataSource 配列の件数を表示。

**7. `action-button`** — API を叩くボタン
```jsonc
{ "type": "action-button", "label": "...", "action": { /* ActionDescriptor */ } }
```

**8. `custom`** — エスケープハッチ。 サービス配信の Web Component を mount
```jsonc
{ "type": "custom", "tag": "bibliotheca-scanner", "url": "/corpus-ui/scanner.js" }
```

### 13.5 データ束縛

- component の `dataSource` / `optionsSource` / form の `submit.dataId` /
  action の `dataId` は **manifest `data[]` の `id`** を指す (任意 URL 不可)。
  Corpus は §4 の `data(dataId, init)` 経由でしか叩かない = サービス契約が
  manifest に閉じ、 Corpus は許可された endpoint しか触れない
- テンプレート: `{field}` を束縛レコードの値で置換。 `{field|filter}` で整形
  (`datetime` / `date` / `time` / `number` / `truncate:N`)
- 束縛元: `list` の item / `detail` の record / `form` の入力値
- パラメタ付きパス: manifest data の `path` に `:param` を許し、
  action の `params` (レコードからテンプレート) で埋める

### 13.6 ActionDescriptor

```jsonc
{ "label": "キャンセル",
  "dataId": "<manifest data id>",
  "method": "DELETE",                  // GET / POST / PATCH / DELETE
  "params": { "id": "{id}" },          // data path の :param をレコード値で埋める
  "body": { /* POST/PATCH 用、 テンプレート可 */ },
  "confirm": "キャンセルしますか?",      // 任意 — 確認ダイアログ
  "success": "キャンセルしました",        // 任意
  "requires": "admin" }                // 任意
```

**トグル action** — on/off ステートを持つ操作 (例: admin の重複可フラグ)。
単発でなく双状態:

```jsonc
{ "label": "重複可",
  "kind": "toggle",                    // 既定は単発。 'toggle' で双状態スイッチ
  "state": "{allowOverlap}",           // 現在値の束縛 (boolean)
  "dataId": "<data id>", "method": "POST", "params": { "id": "{id}" },
  "body": { "allowOverlap": "{toggled}" },  // {toggled} = 反転後の値
  "requires": "admin" }
```

レンダラは `state` からスイッチを描き、 反転時に `{toggled}` を反転後の値で
埋めて送信する。

### 13.7 レンダラの切り出し

宣言レンダラ + descriptor スキーマを **自己完結パッケージ**
(`@ludiars/corpus-renderer` 相当) に実装する。 入力は
「descriptor + `data(dataId, init)` 関数 + identity」 のみで、 Corpus / Memoria
本体に依存しない。 これにより Corpus 本体から、 さらには独立サービスとしても
切り出せる粒度を保つ (ユーザ要件「単独サービスとして切り出せるように」)。

### 13.8 移行

| 段階 | 内容 |
|---|---|
| 1 | descriptor の JSON Schema 確定 + `corpus-renderer` パッケージ (8 component) |
| 2 | `ManifestPanel` を kind 判別 union に。 Corpus frontend が `declarative` panel を内蔵レンダラへ回す。 `script` は現行経路を維持 |
| 3 | **Aedilis を pilot** — declarative panel を 1 枚出す (新しく小さい)。 descriptor 表現力を実地検証 |
| 4 | Bibliotheca (スキャナは `custom`) / Actio を declarative panel 化。 自前 SPA を撤去 |

宣言で書けるものは宣言、 書けないものだけ `custom`/`script` — が原則。

### 13.9 Aedilis pilot 由来のスキーマ反映 (2026-05-21)

§13.8 step 3 の Aedilis pilot (`Aedilis/server/corpus.ts`) で descriptor を
実物に当て、 表現力ギャップ 4 点を §13.4 / §13.6 に反映した:

- `form` select の `optionsPath` — 選択肢レスポンス内の配列パス (§13.4-2)
- `form` select の `optionDetail` — 選択中オプションの詳細表示 (§13.4-2)
- `form` select の `options` — 静的な固定 enum (Bibliotheca pilot で判明、 §13.4-2)
- `list` item の `edit` — 一覧上のインライン編集フォーム (§13.4-1)
- ActionDescriptor の `kind: "toggle"` — on/off ステート操作 (§13.6)

## 14. オープン論点

1. external-id の発行/再割り当てを Cernere 側 (sub 再設計) と Corpus 側
   (マッピング層) のどちらに置くか。
2. 「最小送信」 専用通信ロジックの仕様 (v0.1 は通常 REST)。
3. プラグインパックの frontend バンドル方式 — v0.1 は `panel.js` 静的配信 +
   動的 import。 micro-frontend 化するかは利用実績を見て判断。
4. コネクタの認可中継 — Bearer 透過中継 vs Corpus が再発行。
5. モバイルアプリの実装時期。
