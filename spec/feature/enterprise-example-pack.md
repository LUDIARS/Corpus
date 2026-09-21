# 企業向け連携パックの参照実装

`examples/corp-hub` と `integrations/plugins/enterprise-corpus` の責務境界。
plugin pack の書き方と、その capability を agent から呼ぶ方法を示す実行可能な例で、
Corpus core の業務ドメインではない。

## 構成

| 置き場 | 役割 |
|---|---|
| `examples/corp-hub` | plugin pack の 3 類型 (自前データ / Cernere 正本 / 外部コネクタ)。`announcements` が `registerCapability` の例を兼ねる |
| `integrations/plugins/enterprise-corpus` | Codex plugin。Skill (`scripts/capability.mjs`) と MCP proxy (`scripts/mcp-proxy.mjs`) |

連携パックは業務処理を持たない。`capability.mjs` は `/api/capabilities` を、
`mcp-proxy.mjs` は stdio の JSON-RPC を `/mcp` へ中継するだけで、どちらも server 側の
同じ handler で終わる。`CORPUS_BASE_URL` は必須、`CORPUS_ACCESS_TOKEN` は Cernere 認証を
使う場合のみ。

## capability の例

`announcements` は `list_announcements` (`readOnly: true`) と `create_announcement`
(`readOnly: false`) を登録する。後者は handler の中で `identity.isAdmin` を見る。
認可を transport に任せると、経路が増えたときに素通りする経路ができるため。

## 維持する振る舞い

- 例は公開された plugin / capability 契約だけを使う。
- 例を削除しても Corpus ランタイムは変わらない。
- 例の設定は本番でないことが見て分かる値で、資格情報や組織の非公開値を含まない。
- agent 側 (Skill / MCP) に企業ロジックを複製しない。server が拒否したらその理由を
  そのまま報告し、推測した結果で代替しない。
