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

## プラグインパック

`CORPUS_PLUGIN_DIR` にプラグインパックのルートを指すと、 配下の各モジュールを
動的にロードする。 モジュールはコネクタ / API ルート / hub パネルを登録できる。
仕様は [DESIGN.md §5](./DESIGN.md) を参照。

## ライセンス

MIT
