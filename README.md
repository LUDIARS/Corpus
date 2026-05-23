# Corpus

LUDIARS の **hub サービス**。 散在する LUDIARS 各サービスを一画面に集約し、
ローカル (この PC で動くサービス) と マルチ (サーバ経由で集約) を区別して見せる。

Corpus 単体は汎用 hub フレームワーク。 用途特化 hub (学校・社内 等) は
Corpus を submodule で取り込み、 プラグインパックを載せて作る
(第一号: [VantanHub](https://github.com/LUDIARS/VantanHub) — 学校特化)。

## 構成

- **サーバサイドアプリ** (`server/`) — Hono。 frontend 配信 + マルチ情報集約。 外部公開する hub。
- **ローカルアプリ** (`desktop/`) — Electron。 純クライアント。 ローカルサービスへ直結。
- **frontend** (`public/`) — vanilla TS shell。 タブ + 動的パネルロード。 両ランタイムで共有。

詳細は [DESIGN.md](./DESIGN.md) を参照。

## 開発

```sh
npm install
cp .env.example .env        # CERNERE_BASE_URL 等を埋める
npm run dev                 # サーバサイドアプリ (http://localhost:5185)
```

ローカルアプリ:

```sh
cd desktop
npm install
npm run dev                 # Corpus server を子プロセス起動 + Electron 窓
```

## 一括 dev ツール (scripts/)

Corpus は LUDIARS hub なので、 開発時は他サービス (Cernere / Bibliotheca /
Aedilis 等) を並列起動して manifest を probe するのが一般的。 そのための
2 つの dev utility が `scripts/` にある。

### サービス一括起動: `npm run launch`

```sh
npm run launch:list                      # 知ってる service ID と port を表示
npm run launch -- bibliotheca aedilis    # 2 サービスを並列起動
npm run launch -- --with-cernere bibliotheca aedilis
                                         # cernere を先頭に挿入 (推奨)
npm run launch -- --all                  # registry の全サービス
```

`[<id>]` プリフィックスで stdout/stderr を区別表示。 Ctrl+C で全部 kill。
1 サービスがクラッシュしても他は継続。 サービス registry は
`scripts/services.ts` (= `infra/PORT-MAP.md` + `server/hub/discovery.ts` と同期)。

### Infisical 一括操作: `npm run infisical`

```sh
npm run infisical -- gen bibliotheca aedilis      # 2 サービスで env:gen
npm run infisical -- initialize --all             # env-cli を持つ全サービスで初期値登録
npm run infisical -- list memoria                 # Memoria の env 一覧
npm run infisical -- set FOO=bar bibliotheca      # 1 key 設定 (--代替で渡す)
```

op は `setup / test / gen / list / get / set / initialize` (各サービスの
`env:<op>` script に対応)。 対話 prompt を取り違えないよう直列実行。

### Infisical 初期設定の一括化: `setup-batch`

`env:setup` の対話 5 項目 (siteUrl / projectId / environment / clientId /
clientSecret) のうち **projectId だけが per-service**、 他は通常 1 つの
machine identity を全サービスで共有する。 これを 1 config + 1 コマンドで
全サービスに反映する `setup-batch` がある。

```sh
# 1) テンプレを生成 (.infisical-batch.json — gitignored)
npm run infisical -- setup-batch --init

# 2) 各 service.projectId と defaults.client* を埋める
#    (clientId / clientSecret は 1 machine identity を共有想定)

# 3) 一括書込
npm run infisical -- setup-batch --all
# → 各サービスの .env.secrets を直接生成 (env-cli の対話を bypass)

# 4) 接続確認
npm run infisical -- test --all
```

`.env.secrets` が既に存在するサービスは **skip** (上書きしたい場合は
`--force`)。 `--force` 無しなら誤上書きで既存設定を壊さない。

`.infisical-batch.json` の構造:

```json
{
  "defaults": {
    "siteUrl": "https://app.infisical.com",
    "environment": "dev",
    "clientId": "<shared>",
    "clientSecret": "<shared>"
  },
  "services": {
    "cernere":     { "projectId": "abc..." },
    "bibliotheca": { "projectId": "def..." },
    "aedilis":     { "projectId": "ghi..." }
    // service 側で defaults を override 可
  }
}
```

## プラグインパック

`CORPUS_PLUGIN_DIR` にプラグインパックのルートを指すと、 配下の各モジュールを
動的にロードする。 モジュールはコネクタ / API ルート / hub パネルを登録できる。
仕様は [DESIGN.md §5](./DESIGN.md) を参照。

## ライセンス

MIT
