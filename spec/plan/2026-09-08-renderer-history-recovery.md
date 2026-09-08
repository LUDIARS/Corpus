# Corpus レンダラ分割の履歴回収

## 判断

Memoria #755 の旧ブランチ調査を受け、2026-09-08 neco は「レンダラ分割のみ」を選択した。
企業向け基盤は保留。Tela の登場により Electron を廃止する可能性が高いため、企業向け
Electron 基盤を今のコードへ復旧する作業は行わない。履歴を整理した後の改修は別の判断とする。

## 回収元と基点

- 基点: ローカル main `7610d46`。
- 再提出基点: Revisor の統合済み main `b0c0bf9`。共有checkoutのmainとは別に進んでいた
  `c100f62` のtext/ref描画を `components/text.ts` / `components/unresolved-ref.ts` に残す。
- 回収元: `feat/renderer-srp-split` 内の `b8dab32`。
- `b8dab32` の直前の `public/src/render/renderer.ts` は基点の同ファイルと完全一致。
- `b8dab32` の `public/src/render/` 配下17ファイルの差分のみを適用する。
  旧履歴を祖先として持ち込まず、現行 main の上に新しいコミットを作る。
- 同ブランチ先端 `530eb0a` のアプリ画面・依存更新は回収しない。
  先端の `app.ts` を戻すと、現行の組み込みログインとCookie利用を旧方式に戻してしまう。

## 責務と互換性

`renderer.ts` の公開 `renderPanel` と型定義は維持する。`dispatch.ts` は admin 条件と
component の種類による振り分けを担当する。`components/` が各部品の描画、`internal/` が
DOM生成、テンプレート展開、操作、フォーム入力、ページ送りを担当する。

子 component を含む描画には `RenderChild` を注入し、components から dispatch を
逆参照しない。回収元で dispatch に残っていた section / tabs / action-button の描画も
components に移す。CSSクラス・DOM構造・操作・権限条件の変更は意図しない。

既存 `client-renderer` ドメインの membership をサブディレクトリへ拡張する。
公開入口を使う既存テスト、特に main で分離済みの `style-contract.test.ts` は維持する。
レンダラをコピーする利用側は、従来どおりディレクトリ全体を同期する必要がある。
この変更では別リポジトリへ配布しない。

## 旧履歴の扱い

| 旧ブランチ・対象 | 照合結果・扱い |
|---|---|
| `chore/harness-ci` | 変更対象 `.github/workflows/harness.yml` は基点と一致。回収不要 |
| `docs/auth-plane-consolidation` | 対象 `spec/plan/auth-plane-consolidation.md` は基点と一致。回収不要 |
| `feat/renderer-srp-split` | 分割差分 `b8dab32` のみ回収 |
| `feat/enterprise-electron-capability-base` | 未回収の基盤がある。上記ユーザー判断により保留 |
| `fix/review-2026-07-13-noauth-loopback` | 現行は認証モードが変わり、edge開発バイパス時にloopback指定がある。旧ファイルをそのまま戻さない |
| その他の旧認証・依存更新ブランチ | ファイル差分があるだけでは未回収と断定できない。今回の回収対象から除外 |
| `preserve/local-main-pre-recreate-20260808` | 非公開化前の履歴を保持する保全用。回収・push・削除しない |

祖先判定が外れる旧ブランチには、履歴再作成前と同等のpatchも含まれていた。
`git cherry` の未一致やブランチ先端の全体差分だけでrebase対象を選ばない。
元のbranch、既存worktree、共有checkoutの変更はそのまま保全する。

## 確認方法

元ファイルと回収後の関数を静的に照合し、公開入口、依存方向、相対import、既存テストの
保持と変更範囲を確認する。単体・統合・動作テスト、サービス起動・再起動はユーザー指示で
実行しない。既存のrenderer / modal-pagination / layouter / dock / style-contract と
descriptor描画のテストが回帰確認の対象となる。未実施を成功として扱わない。
