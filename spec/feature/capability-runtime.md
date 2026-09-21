# capability の共有実行基盤

UI・Skill・MCP から同じ処理を呼ぶための実行経路を定義する。API 表の正本は `DESIGN.md` §8。
Corpus 本体は capability の中身を持たず、プラグインが登録した handler を仲介するだけ。

## 登録

`server/hub/types.ts` の `CorpusCapability` をプラグインの `setup()` から
`ctx.registerCapability()` で登録する。`server/hub/registry.ts` が所有者で、登録時に

- id が `^[a-z][a-z0-9_]*$` に一致すること
- 同一モジュール内で重複しないこと

を検査し、違反は `setup()` を失敗させる。`HubRegistry` は setup 成功後にまとめて
commit するため、途中まで登録された capability がレジストリへ残らない。
公開 id は `<moduleId>.<capabilityId>`、MCP tool 名は `<moduleId>__<capabilityId>`。

## 実行

`invokeCapability(moduleId, capabilityId, input, identity)` が唯一の実行入口で、
handler には `identity` / `db` / `logger` を渡す。未知の組は `CapabilityNotFoundError`。

| 経路 | 入口 | 実装 |
|---|---|---|
| HTTP | `GET /api/capabilities`, `POST /api/capabilities/:moduleId/:capabilityId/invoke` | `server/routes/capabilities.ts` |
| MCP | `POST /mcp` (JSON-RPC 2.0: `initialize` / `ping` / `tools/list` / `tools/call`) | `server/routes/mcp.ts` + `server/hub/mcp-adapter.ts` |

どちらも `requireAuth` の配下に置く。`/mcp` は `/api/*` の外なので `server/index.ts` で
明示的に middleware を被せる。認可は transport ではなく handler が持つ
(`invocation.identity` を見て判断する)。

## 維持する振る舞い

- 一覧は実行しない。`GET /api/capabilities` と `tools/list` は handler を呼ばない。
- HTTP と MCP は同一の Cernere identity を handler へ渡す。
- 壊れた JSON は 400 / JSON-RPC `-32700`、未知の capability は 404、handler 失敗は 422
  もしくは `isError: true` の tool result として返す。代替実装へ落ちない。
- `readOnly` は MCP の `readOnlyHint` / `idempotentHint` にそのまま出る。状態を変える
  capability は `readOnly: false` を宣言する。
