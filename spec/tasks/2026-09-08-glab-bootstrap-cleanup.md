---
task: glab-bootstrap-cleanup
project: Corpus
kind: 実装
created: 2026-09-08
memory_links:
  - E:/Document/Ars/GLAB/spec/plan/2026-09-08-cernere-ws-client-lifecycle-design.md
---
# Host が bootstrap 失敗時の cleanup を実行できる契約

## 目的

Corpus 内部の process.exit(1) により GLAB の client/store cleanup が飛ばされる経路を解消する。
現状の hard exit は `server/index.ts` の module 評価時 (requireEnv / CORPUS_AUTH_UI_MODE /
CORPUS_AUTH_MODE / CORPUS_EDGE_DEV_IDENTITY) と makeTokenProvider 失敗時にあり、
`server/bootstrap.ts` は `await import('./index.ts')` でこれを引き込む。

## 完了条件

- 起動経路の直接 hard exit を列挙し、host へ例外を返す API と standalone entrypoint を分離する。
- GLAB が共有 client を閉じてから store を閉じる順序を維持し、cleanup owner を二重化しない。
- 単一 plugin setup 失敗の隔離では他 plugin の共有資源を閉じない。
- 全体失敗、signal、複数回 cleanup、捕捉不能な強制終了を区別した契約テストを用意する。
- GLAB が依存更新後に利用できる import 契約と対応 commit を記録する。

## スコープ (編集可ディレクトリ)

- `server/` (テストは同階層の `*.test.ts` に置く)
- `spec/`
