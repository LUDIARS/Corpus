# 引き継ぎ — 宣言的 UI (Corpus DESIGN.md §13) 残作業

> **作成**: 2026-05-23 (A track / KS-Pictor パイプライン側のセッションから)。
> **対象**: 宣言的 UI を担当する後続セッション。
> **正本**: `Corpus/DESIGN.md` §13、 §14、 各サービスの `corpus.ts`。
> 本書は現状把握ショートカットとしての整理メモ。 矛盾が出たら DESIGN.md
> を信じる。

## 0. 全体ロードマップ (§13.8)

| 段階 | 内容 | 状態 |
|------|------|------|
| 1 | descriptor JSON Schema + `corpus-renderer` (9 component) | ✅ 完了 (`public/src/render/renderer.ts` 596 行 + vitest 708 行) |
| 2 | `ManifestPanel` kind union (`corpusApi: 2`) + Corpus が `declarative` panel を内蔵レンダラへ回す | ✅ 完了 (Corpus PR #10 merged) |
| 3 | **Aedilis pilot** (declarative panel 1 枚) — 表現力ギャップ反映 | ✅ 完了 (§13.9 で descriptor 4 拡張点を反映済) |
| 4 | **Bibliotheca / Actio を declarative panel 化、 自前 SPA 撤去** | ⚠️ **進行中** — Bibliotheca は β ページ追加済 (PR #5)、 Actio は未着手 |

## 1. 残作業 (優先度順)

### 1.1 Bibliotheca の自前 SPA 撤去 (step 4 前半)

**現状 (2026-05-23 更新)**:
- ✅ **declarative β ページ追加済** — `Bibliotheca/public/declarative.html` + `public/src/declarative.ts` + `public/src/corpus-renderer/` (vendor copy)
- ✅ topbar に「📋 β」 リンクで discoverable
- 既存 SPA (`public/app.js` 約 35,000 行) は無改変で共存中
- 取込スコープ: 貸出フォーム / 貸出中一覧 (admin 返却 action) / 自分の貸出一覧
- 取込外: QR/ISBN スキャナ (camera + zxing → app.ts のまま)、 機材マスタ管理

**次のステップ**:
1. ブラウザ動作確認 → 表現力ギャップ洗い出し
2. ギャップを §13.4 descriptor 拡張で埋める (Aedilis pilot と同じパターン)
3. 既存 SPA をスキャナ専用ページに最小化 → 通常 UI は declarative にシフト
4. `🏗 β` ラベルを外して正式 UI に格上げ

**参照**:
- `Bibliotheca/public/declarative.html` (新規 β ページ)
- `Bibliotheca/public/src/declarative.ts` (bootstrap + data() 実装)
- `Bibliotheca/public/src/corpus-renderer/` (vendor copy — Corpus 同期前提)
- `Bibliotheca` PR #5 (declarative-loans-panel) — merged
- `Corpus/DESIGN.md` §13.2 — `script` / `custom` はエスケープハッチ

### 1.2 Actio の自前 SPA 撤去 (step 4 後半)

**現状**:
- `Actio/src/corpus.ts` は declarative 宣言済 (205 行)
- frontend/ は **Vite + React 19** (Bibliotheca と違ってフレームワーク重め)
- 自前 SPA (frontend/dist/src/app.js) が標準 UI

**やること** (Bibliotheca PR #5 パターンを移植):
1. `Actio/frontend/src/corpus-renderer/` に Corpus からの vendor copy を置く
2. `Actio/frontend/declarative.html` + `frontend/src/declarative.ts` を新規追加
3. `vite.config.ts` の `build.rollupOptions.input` に declarative.html を加えて multi-entry mode に
4. React 側 (main.tsx) には触らない (既存 UI 維持)
5. 表現力ギャップが出たら descriptor 拡張 PR

**descriptor 表現力レビューが先に必要かも**: Actio のタスク管理 UI (drag-drop / dependent select 等) が現行 9 component (list/form/table/modal/grid/stack/...) で書けるか先に検証 → 不足 component は Corpus PR で追加してから移植

### 1.3 §14 オープン論点を閉じる

| # | 論点 | 推奨初手 |
|---|------|----------|
| 1 | external-id の発行/再割当を **Cernere (sub 再設計)** vs **Corpus (マッピング層)** どちらに置くか | Cernere 担当 session と相談。 既存 `Cernere/AUTH_DESIGN.md` を参照 |
| 2 | 「最小送信」 専用通信ロジック (v0.1 は通常 REST) | 計測してから判断 — 現状でボトルネックなら設計、 そうでなければ deferred |
| 3 | プラグインパック frontend バンドル方式 — `panel.js` 静的 + 動的 import / micro-frontend 化 | 利用実績待ち。 declarative shift 進行中なので bundle 自体が縮小していく |
| 4 | コネクタの認可中継 — Bearer 透過中継 vs Corpus 再発行 | secret per-user / memory-only ([[feedback_secret_per_user_memory_only]]) の方針と整合させる |

### 1.4 descriptor 表現力ギャップが見つかった都度の拡張

Aedilis pilot で §13.9 に 4 件反映済 (form select の `optionsPath` /
`optionDetail` / 静的 `options`、 `list` item の `edit`)。 Bibliotheca / Actio
の SPA 撤去過程で同様のギャップが見つかったら同じ手順で `Corpus/DESIGN.md`
§13.4 / §13.6 を更新 + `public/src/render/renderer.ts` に実装追加 + vitest
拡張。

## 2. 触れちゃダメな範囲 (A track と分離)

宣言的 UI と直交しているので **触らない**:
- `Pictor/` 全般 (パイプライン ノード化は別 session で進行中)
- `KuzuSurvivors/` 全般 (Phase 4 step 3+ は別 session)
- `ergo/tools/ergo/src/plugins/render_pipeline/` (render_pipeline editor)
- `ergo/PR #35` (ergo-web の宣言的 IR 化 — Custos 統合込みの大型 draft、 着手は
  ユーザ明示指示後)

並行作業の事故防止は [[feedback_concurrent_session_branch]] に従って必ず
feat ブランチを切ってから編集。 main 直編集は厳禁。

## 3. 着手前チェックリスト

- [ ] `Corpus/DESIGN.md` §13 + §14 を読む (本書は要約、 正本ではない)
- [ ] `Corpus/public/src/render/renderer.ts` で現在実装されている 9 component
      の挙動を確認 (vitest があるので test 経由が早い)
- [ ] `Aedilis/server/corpus.ts` で descriptor の実用例を読む (最初の pilot
      なので最も練れている)
- [ ] 並行 session 状況を Concordia で確認 (`GET /v1/stat`、 アクティブ peer
      に Pictor/KS 担当がいるはず)

## 4. 進捗の Concordia 報告

10 分毎の `stat-collect` task でこの track の状態 (どのサービスの SPA 撤去
何 % / どの §14 論点を解いたか) を JSON で post してくれると、 Pictor/KS 側
セッションも全体感を持てる。

## 5. 完了条件

- Bibliotheca / Actio が declarative panel only (自前 SPA 撤去 or 最小化)
- §14 オープン論点 4 件いずれかが close
- `Corpus/DESIGN.md` §13 step 4 行 ✅ にマーク + §14 整理

§13 完了の暁には 「サービスは UI を書かない (descriptor だけ書く)」 という
当初目標が達成される。
