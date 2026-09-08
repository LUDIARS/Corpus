---
task: glab-host-policy
project: Corpus
kind: 実装
created: 2026-09-08
memory_links:
  - E:/Document/Ars/GLAB/spec/plan/2026-09-08-member-authorization-design.md
---
# GLAB が部員認可を共通適用できる host policy hook

## 目的

本人認証後、plugin API と hub aggregation の双方で同じ host policy を必ず呼ぶ。部員資格の正本は GLAB に置く。

## 完了条件

- host が method、正規化済み path、認証済み identity を受ける policy hook を登録できる。
- `/api/x/*` と `/api/hub/data` を同じ policy で保護し、拒否後に plugin や集約処理を実行しない。
- GLAB が membership 状態、期限、profile と管理者名簿の限定例外を判定でき、一般 API への admin bypass を作らない。
- 403/503 と no-store を保持し、policy 例外時は503で fail closed にする。
- 既存 host の後方互換性、登録順序、複数 policy の扱いを SDK に記載し、両入口を対象とする契約テストを用意する。
- 提供する API、利用例、対応 commit を GLAB へ引き渡すまで GLAB 側の部分導入を完了扱いにしない。

## スコープ (編集可ディレクトリ)

- `server/` (テストは同階層の `*.test.ts` に置く)
- `spec/`
