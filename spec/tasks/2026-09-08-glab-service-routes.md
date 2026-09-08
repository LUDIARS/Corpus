---
task: glab-service-routes
project: Corpus
kind: 実装
created: 2026-09-08
memory_links:
  - E:/Document/Ars/GLAB/spec/plan/2026-09-08-consult-notification-machine-auth-design.md
  - E:/Document/Ars/Cernere/spec/tasks/2026-09-08-glab-notifier-machine-principal.md
---
# 通知専用 service route と machine token 検証境界

## 目的

Cernere の machine principal 契約提供後、利用者 API と分離した `/service/x/:module/*` 登録 API を提供する。

## 完了条件

- 専用 principal、iss/sub/aud/exp/jti、scope、署名鍵の active 状態と credential generation 失効を毎回検証する。
- GLAB canonical URL と audience は完全一致、TTL 5分、skew 30秒。失効照会不能は503、欠落・不正・期限切れは401、scope 不足は403。
- service token が一般 user API に使えず、user cookie だけでも service API に入れない。
- method/path ごとの read/ack 最小 scope 宣言を必須とし、presence と一般更新 API を公開しない。
- token・credential をログや応答に含めず、認証エラーを no-store にする。
- GLAB の journal と冪等 ACK を接続するための SDK 利用例と契約テストを残す。

## スコープ (編集可ディレクトリ)

- `server/` (テストは同階層の `*.test.ts` に置く)
- `spec/`
