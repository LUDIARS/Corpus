---
task: glab-token-cache-lifecycle
project: Corpus
kind: 実装
created: 2026-09-08
memory_links:
  - E:/Document/Ars/GLAB/spec/plan/2026-09-08-corpus-token-cache-contract.md
---
# 下流 token cache の並行発行と寿命を統一する

## 目的

同一 key の token 発行を in-flight Promise で共有し、期限切れ cache と失敗 Promise を保持しない。

## 完了条件

- GLAB 設計文書の key、expiry、安全余裕、掃除契機と容量上限を実装へ対応付ける。
- keyはincoming token fingerprint・project key・正規化audience。同一keyは発行1回、いずれかが異なれば共有しない。
- 期限30秒前から無効とし、get/setで掃除する。1024件上限を超えたら期限切れ、expiryが早い順に除去する。
- 発行fetchは有限timeoutとし、expiresInがfiniteかつ正の値の場合だけcacheする。
- 成功した有効 token のみ cache し、失敗時は cache/in-flight を除去して次の再試行を可能にする。
- 発行失敗・空 token を匿名中継の許可として扱わず、呼出元へ明示失敗を返す。
- 時刻注入による期限境界、並行発行、失敗再試行、掃除の契約テストを用意する。

## スコープ (編集可ディレクトリ)

- `server/hub/` (テストは同階層の `*.test.ts` に置く)
- `spec/`
