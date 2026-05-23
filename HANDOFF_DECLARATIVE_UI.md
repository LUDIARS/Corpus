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
| 4 | **Bibliotheca / Actio を declarative panel 化、 自前 SPA 撤去** | ⚠️ **半分** — corpus.ts は宣言済、 自前 SPA は未撤去 |

## 1. 残作業 (優先度順)

### 1.1 Bibliotheca の自前 SPA 撤去 (step 4 前半)

**現状**:
- `Bibliotheca/server/corpus.ts` は `corpusApi: 2 / kind: 'declarative'` で descriptor を返している (Corpus 内蔵レンダラ向け)
- 一方で `Bibliotheca/public/app.js` (約 35,000 行) の自前 SPA が並存している
- Bibliotheca 単体起動でも使えるよう SPA を残す設計 vs 完全撤去の選択

**やること**:
1. 単体起動の必要性をユーザに確認。 不要なら撤去
2. 必要なら最小化 (descriptor が正本、 SPA は薄いラッパー) で残す
3. スキャナ機能 (QR/ISBN) は宣言で書けないので `custom` kind の component で
   残す (§13.4 の `custom` component 仕様を参照)

**参照**:
- `Bibliotheca/server/corpus.ts` (descriptor 宣言)
- `Bibliotheca/public/app.js` (撤去対象)
- `Corpus/DESIGN.md` §13.2 — `script` / `custom` はエスケープハッチ

### 1.2 Actio の自前 SPA 撤去 (step 4 後半)

**現状**:
- `Actio/src/corpus.ts` は declarative 宣言済 (205 行)
- `Actio/dist/src/app.js` などの SPA が残存
- Actio はタスク管理 UI が比較的複雑。 descriptor で表現できるか確認必要

**やること**:
1. corpus.ts の descriptor が現行 SPA の機能を網羅しているかレビュー
2. 不足があれば descriptor 拡張 PR (Corpus 側 §13.4 component 追加 / プロパティ拡張)
3. SPA 撤去

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
