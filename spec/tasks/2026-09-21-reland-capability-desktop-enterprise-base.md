---
task: reland-capability-desktop-enterprise-base
project: Corpus
kind: 実装
created: 2026-09-21
memory_links:
  - spec/feature/capability-runtime.md
  - spec/feature/desktop-runtime.md
  - spec/feature/enterprise-example-pack.md
---
# 未着地の企業向け Electron / capability 基盤を現在の main へ入れ直す

## 目的

ローカル PR #8 (`feat/enterprise-electron-capability-base`) は 2026-08-11 起点の断面で、
merge-base は `158972c`、main からは 55 日遅れている。その間に main は宣言的レンダラ、
終了契約 (`lifecycle.ts` / `bootstrap-runtime.ts`)、エッジ認証ガード、共有 UI 解決、
ドメイン定義の `spec/domains/` 移設を取り込んだ。ブランチをそのまま載せ直すと、これらを
すべて巻き戻す。

一方で、この PR にしか無い機能が 4 つある (main に同名も相当物も無いファイル 34 本)。
これらを捨てずに、現在の main の構成へ入れ直す。

- **A. capability ランタイムと MCP アダプタ** — プラグインが登録した handler を
  UI・Skill・MCP から同じ identity と入力契約で呼ぶ実行基盤。main には無い。
- **B. デスクトップランタイム** — 設定駆動の再ブランド、内蔵 server プロセスの所有、
  Electron Forge パッケージング、自動更新。main の `desktop/` は `main.ts` と
  `preload.ts` だけの最小シェルで、配布できる形になっていない。
- **C. 企業向け連携パック** — `integrations/plugins/enterprise-corpus` から
  A の capability / MCP 契約を叩く Codex plugin。
- **D. 仕様とドメイン定義** — A〜C の責務境界を `spec/feature/` に書き、着地先を
  `spec/domains/` のドメインへ紐づける。

## 完了条件

- main と内容が異なるファイルは main 側を正とし、A〜C の成立に必要な差分だけを取り込む。
  main で進んだ実装 (終了契約・エッジガード・宣言的レンダラ等) を巻き戻さない。
- `HubRegistry` が capability の登録・列挙・実行を所有し、id 規約違反と重複登録が
  `setup()` を失敗させる。半端に登録された capability がレジストリに残らない。
- `GET /api/capabilities` / `POST /api/capabilities/:moduleId/:capabilityId/invoke` と
  `POST /mcp` が同じ handler を同じ Cernere identity で呼ぶ。`/mcp` は `/api/*` の外に
  あるため `requireAuth` を明示的に被せる。
- 一覧経路 (`GET /api/capabilities`, `tools/list`) は handler を実行しない。壊れた JSON・
  未知の capability・handler 失敗がそれぞれ別のプロトコルエラーになり、代替実装へ落ちない。
- デスクトップ配布物が `desktop/corpus.desktop.json` だけで再ブランドでき、設定が
  見つからないときは既定値で起動せずに終了する。内蔵 server を起動した所有者が、
  起動失敗時と終了時の双方で停止させる。
- `desktop` の `better-sqlite3` がリポジトリ root と同じ版に揃い、lockfile が一致する。
- ドメイン定義は `spec/domains/` に置く。`.anatomia/domains/` と `spec/data/ontology/` へは
  置かない。新設するドメインは既存 9 ドメインと境界が重複しないものに限り、重複するなら
  既存ドメインの `membership` を広げる。追加したコードが未束縛にならない。
- 新規の production コードに対のテストがある (`server/hub/mcp-adapter.test.ts`,
  `server/routes/mcp.test.ts`, `server/routes/capabilities.test.ts`,
  `server/hub/registry.test.ts` の capability ケース)。
- `spec/feature/` に A〜C の責務境界が書かれ、`DESIGN.md` の API 表と §10 が実装と一致する。
- `git diff | anatomia verify` が block ゲートを通る。

## スコープ (編集可ディレクトリ)

- `server/hub/`, `server/routes/`, `server/index.ts`
- `desktop/`
- `integrations/plugins/enterprise-corpus/`
- `examples/corp-hub/`
- `spec/feature/`, `spec/domains/`, `spec/tasks/`, `DESIGN.md`, `.gitignore`

対象ドメインは `hub-federation` / `hub-delivery` / `desktop-shell` / `plugin-examples`
(`spec/domains/`)。`lib/` 配下の submodule は触らない。
