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

### ローカルデバッグ (Cernere 不要)

UI / hub の動作確認だけしたいときは Cernere を介さずに起動できる。 認証は
bypass され、 全リクエストが固定の dev identity (`dev-user`, admin) で
処理される。 downstream service への参照先トークン発行は機能しない (= 実
データ取得は service 側も noauth でないと 401)。

```sh
npm run dev:debug                                  # --no-cernere --port=5187 のショートカット
npm run dev -- --no-cernere --port=5187            # CLI args 個別指定
npm run dev -- --no-cernere --port=5187 --mode=local --probe=17501,17502
npm run dev -- --no-cernere --port=5187 --services=http://localhost:17501,http://localhost:17502
```

CLI args (env と同等、 env より優先):

| flag | env | 用途 |
|------|-----|------|
| `--port=N` | `CORPUS_PORT` | listen port (default 5185) |
| `--no-cernere` | `CORPUS_NO_AUTH=1` | 認証 bypass + CERNERE_BASE_URL を要求しない |
| `--services=<list>` | `CORPUS_SERVER_SERVICES` | server モードで集約する baseUrl (カンマ区切り) |
| `--mode=server\|local` | `CORPUS_MODE` | discovery モード |
| `--probe=<ports>` | `CORPUS_LOCAL_PROBE_PORTS` | local モードで probe する port |
| `--plugin-dir=<p>` | `CORPUS_PLUGIN_DIR` | プラグインパックの dir |
| `--public-url=<u>` | `CORPUS_PUBLIC_URL` | 公開 URL (audience) |

⚠️ `--no-cernere` / `CORPUS_NO_AUTH=1` は **ローカル開発専用**。 admin 権限の
dev-user が全リクエストを処理する状態になるため、 本番では絶対に立てない。

### 参照先トークン伝播 (`CORPUS_TOKEN_MODE`)

参照先サービスを叩くとき、 どのトークンを送るかを `CORPUS_TOKEN_MODE` で選ぶ
(D5)。 **明示必須** — 未設定だと起動を拒否する (無言フォールバック禁止。 設定
漏れが「ユーザ Bearer 素通し」 = 最も弱い経路に静かに落ちるのを防ぐ)。

| 値 | 意味 |
|----|------|
| `passthrough` | 受信 Bearer をそのまま転送 (audience が揃う構成 / 無認証ローカル直結向け) |
| `cernere-project-token` | 参照先プロジェクト用の短命 PASETO を Cernere で発行 (本番想定) |

例外: ローカル無認証 dev (`--no-cernere` / `CORPUS_NO_AUTH=1`) のときだけ、
未設定でも `passthrough` を既定として許す (ローカル開発を壊さないため)。 不正な
値 (上記以外) はこの dev 例外下でも常に起動拒否する。

ローカルアプリ:

```sh
cd desktop
npm install
npm run dev                 # Corpus server を子プロセス起動 + Electron 窓
```

## 一括 dev ツール (scripts/)

Corpus は LUDIARS hub なので、 開発時は他サービス (Cernere / Bibliotheca /
Aedilis 等) を並列起動して manifest を probe するのが一般的。 そのための
launch utility が `scripts/` にある。

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

### Infisical 一括操作

LUDIARS repo に集約 (`../LUDIARS/scripts/infisical.mjs`)。 詳細は
`LUDIARS/scripts/README.md` を参照。

```sh
cd ../LUDIARS
npm run infisical -- setup-batch --init
npm run infisical -- setup-batch --all
npm run infisical -- gen --all
```

## プラグインパック

`CORPUS_PLUGIN_DIR` にプラグインパックのルートを指すと、 配下の各モジュールを
動的にロードする。 モジュールはコネクタ / API ルート / hub パネルを登録できる。
仕様は [DESIGN.md §5](./DESIGN.md) を参照。

## ライセンス

MIT
