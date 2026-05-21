# Corpus ローカルアプリ (desktop)

Corpus の **ローカルアプリ** — 外部公開 web フロントを持たない純クライアント
Electron shell。 内蔵 Corpus server を子プロセスで起動し、 frontend を窓に表示する。

## 開発

事前にリポジトリ root の `.env` を用意しておくこと (`CERNERE_BASE_URL` 等)。

```sh
cd ..              # Corpus repo root
npm install        # server 側の依存
cd desktop
npm install        # electron 等
npm run dev        # build → electron 起動
```

`npm run dev` は内蔵 server を loopback 17520 で起動し、 ウィンドウに表示する。
ウィンドウの × はトレイ最小化。 完全終了はトレイメニューから。

## 用途特化 hub での拡張

VantanHub などの用途特化 hub は、 この shell を出発点に
マスコット窓・最前面通知などを足した独自の Electron アプリを持つ
(VantanHub では `desktop/` に実装)。
