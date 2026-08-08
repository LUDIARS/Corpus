# 認証面の集約 — Hub が service 間認証を引き受ける

service 間認証を Hub に集約し、表示用の project key が認可や storage の挙動を
左右しない設計へ移行する。

## 1. 何が起きているか

現状、service 間の認証方式が **6 系統**並立している。実測。

| # | 方式 | 使っている所 | 資格情報 |
|---|---|---|---|
| 1 | Cernere project client credentials → `/ws/project` | 全 project client | `client_id` / `client_secret` |
| 2 | PASETO project-token (`/api/auth/project-token`) | Corpus `CernereProjectTokenProvider` | 上記から発行、`/.well-known/cernere-public-key` で検証 |
| 3 | OIDC RP (RS256 id_token + JWKS) | Volputas HASTER、Cloudflare Access | `CERNERE_OIDC_CLIENT_ID` / `_SECRET` |
| 4 | **ヘッダに直書きの共有秘密** | 下記のとおり多数 | 手配布の固定文字列 |
| 5 | Ed25519 assertion | Ostiarius 出席、`X-Discutere-Persona-Assertion` | 署名鍵ペア |
| 6 | edge assertion (Cloudflare Access バイパス) | Cernere `edge-assertion.ts` | edge JWKS |

4 の実体 (これが増殖している):

```
X-Glab-Service-Token          GLAB_SERVICE_TOKEN
                              GLAB_PROJECTS_SERVICE_TOKEN
                              CALLIOPE_SERVICE_TOKEN
                              DISCUTERE_PERSONA_BRIDGE_TOKEN
                              VOLPUTAS_PERSONA_EXPORT_TOKEN
X-API-Key                     (Discutere 系)
```

## 2. なぜ増えたか — 根本原因

`server/hub/tokens.ts` の `TokenProvider` は **受信したユーザ token を前提にしている**。

```ts
getDownstreamToken(incomingToken: string | null, target: DownstreamTarget)
```

`CernereProjectTokenProvider` は「受信 token を user accessToken とみなし、
Cernere に参照先プロジェクト用の短命 PASETO を発行させる」。つまり
**ユーザ文脈のある呼び出ししか通せない。**

ところが実際の service 間呼び出しには、ユーザが居ないものが多い。

- bot の scheduler が感想リレーを取りに行く (`glab_review_relay` の巡回)
- Volputas → GLab の `review-relay` 投函
- Discutere persona bridge のエクスポート
- Calliope が PJ health を配る

これらは `incomingToken` が無い。Hub の口が塞がっているので、**各サービスが
自前で固定トークンを配った。** 鍵が多いのは運用の怠慢ではなく、
Hub 側に service 文脈の経路が無いことの帰結。

## 3. 併発している問題 — 名前が挙動を決めている

同じ根から出ているもう 1 つ。project key が 3 つの役割を兼務している。

| 役割 | 現状 | 問題 |
|---|---|---|
| 人が読む識別子 | `managed_projects.key` | 改名したい (匿名化) |
| **SQL 識別子** | `project_data_${key}` | 改名すると別テーブルになる |
| **認可の判別子** | `if (projectKey !== "...")` | サービス名が分岐条件 |

そのため `key` に `/^[a-z][a-z0-9_]{1,62}$/` という制約が要り、匿名化で入った
`EducationLab` は**この制約に落ちて project-data 系が全滅する** (`safeTableName` /
`projectDefinitionSchema` の両方で reject)。名前を変えただけで挙動が変わっている。

認可の判別子としての兼務は、Cernere #282 で `identity_claims` /
`user_data.columns` の宣言駆動に置き換え済み。**残りは SQL 識別子の兼務。**

## 4. 方針

### 4.1 資格情報は 1 サービス 1 組だけにする

正本は **Cernere project client credentials (`client_id` / `client_secret`)** の 1 組。
配布は既存の Excubitor launch credentials
(`cernere_launch_credentials`) に一本化する。他は全てここから導出する。

手配布の固定トークン (§1 の 4) は**新規発行を止め、既存は移行して廃止する。**

### 4.2 TokenProvider に service 文脈を足す

これが本丸。`TokenProvider` の口を 2 つにする。

```ts
export interface TokenProvider {
  readonly mode: string;
  /** ユーザ文脈: 受信 token を参照先向けに変換する (現行)。 */
  getDownstreamToken(incomingToken: string | null, target: DownstreamTarget): Promise<string | null>;
  /** service 文脈: ユーザ不在の呼び出しに、自分の資格情報で token を得る。 */
  getServiceToken(target: DownstreamTarget): Promise<string | null>;
}
```

`getServiceToken` は Cernere に自分の `client_id` / `client_secret` を提示して
**scope 付きの短命 PASETO** を貰う。既存の user 版と同じ検証経路
(`/.well-known/cernere-public-key`) に乗せる。受け側には署名検証に加えて audience と
scope の検査を実装する。

発行 API は、認証済み client の不変な project 識別子を `sub`、呼出先を `aud`、
許可済み操作を `scope` として token に入れる。受け側は署名・`exp`・`aud`・要求 scope
を検証する。`scope`、`sub`、`aud` は呼出し側の request body から受け取らず、Cernere
側の登録情報または信頼済み Hub registry から解決する。client credentials を Cernere
以外へ送ってはならない。

発行済み token は process memory のみにキャッシュする (現行方針を踏襲、disk /
Infisical に残さない)。

### 4.3 権限は宣言で決める。名前で決めない

「誰が何を呼べるか」を呼び出し元の名前で判定しない。#282 で入れた宣言駆動を
service scope へ広げる。`managed_projects.schema_definition` に:

```json
{
  "service_scopes": ["review-relay:write", "persona-export:read"]
}
```

`identity_claims` と同じ **管理者所有フィールド**にする (自己申告は保存しない)。
Cernere は token 発行時に保存済みの宣言からのみ `scope` を導出する。受け側は token の
呼出元名で分岐せず、検証済みの `aud` と、その endpoint に必要な `scope` を照合する。

これで `if (projectKey !== "glab")` 型の分岐は書けなくなる。

### 4.4 storage 識別子を key から切り離す

`managed_projects` に**不変の storage 識別子**を持たせ、`project_data_*` の解決を
そちらに移す。

```
ALTER TABLE managed_projects ADD COLUMN storage_slug TEXT;
-- 既存行は key をそのまま backfill (project_data_glab は動き続ける)
-- backfill 後に storage_slug を NOT NULL / UNIQUE にし、安全な slug だけを許可する
-- 以降 storage_slug は発行時に固定し、二度と変えない
```

`safeTableName(projectKey)` / `tableNameFor(projectKey)` を廃し、
`resolveStorageTable(projectKey)` が `storage_slug` を引く形にする。呼び出し箇所は
実測で 8 箇所 (`service.ts` 4 / `schema-migrator.ts` 2 / `user-data-query.ts` 1 /
export 1)。

**結果**: project key は storage と認可を決めないラベルになる。`glab` →
`EducationLab` の改名がデータにも認可にも影響しなくなり、key の文字種制約も外せる。
`storage_slug` の値は常にサーバー側で検証して table identifier に解決する。

### 4.5 OIDC は外部 RP 専用に戻す

OIDC (§1 の 3) は Cloudflare Access のような**本当に外部の RP** 向けに限定する。
内部 service 間の認証に OIDC を使わない (Volputas HASTER は 4.2 へ移す)。
Cernere #282 で署名鍵を DB 永続化済みなので、再起動での失効はもう起きない。

## 5. 残す方式と、その理由

全部を潰すのが目的ではない。**別の脅威モデルを持つものは残す。**

| 方式 | 判断 | 理由 |
|---|---|---|
| Ed25519 assertion (Ostiarius 出席) | **残す** | 「その端末がその場に居た」の証明で、service 認証とは別問題。鮮度 120 秒と replay 検出が本質 |
| edge assertion (Cloudflare Access) | **残す** | 信頼境界がネットワーク edge にある。Cernere の外で成立する認証を受け取る口 |
| user OAuth (GitHub / Google / Discord) | **残す** | ユーザ本人の認証であって service 認証ではない |

## 6. 段階

前段が終わらないと次が動かない順に並べる。

1. **P1 storage_slug** — 4.4。他と独立で、`EducationLab` の実害を先に止める。
   migration + 8 箇所の呼び出し変更 + key 制約の緩和。
2. **P2 getServiceToken** — 4.2。Corpus `TokenProvider` の拡張と Cernere 側の
   service token 発行。この時点ではまだ誰も使わない。
3. **P3 service_scopes** — 4.3。宣言と受け側の検査。
4. **P4 移行** — 固定トークンの利用箇所を P2/P3 へ 1 つずつ載せ替える。
   `X-Glab-Service-Token` → `GLAB_PROJECTS_SERVICE_TOKEN` →
   `DISCUTERE_PERSONA_BRIDGE_TOKEN` → `VOLPUTAS_PERSONA_EXPORT_TOKEN` →
   `CALLIOPE_SERVICE_TOKEN` の順 (依存の浅い方から)。
5. **P5 撤去** — 移行完了を確認してから env と検証コードを消す。
   Infisical からの削除もここ。

P1 と P2 は並行できる。P4 は 1 本ずつ、前の 1 本が動いてから次へ。

## 7. 判断が要る点

- **P1 の backfill 後、key の文字種制約をどこまで緩めるか。** storage から切れれば
  表示名と同等まで緩められるが、URL や log に出る以上ある程度の制限は要る。
- **service token の TTL。** user 版と揃えるか、常駐 scheduler 向けに長めにするか。
- **P4 の移行中、受け側が新旧両方を受理する期間を設けるか。** 設けないなら
  送信側と受信側を同時に切り替える必要がある。

## 8. 関連

- Cernere `spec/feature/identity-claims.md` — 宣言駆動の先行事例 (#282)
- Corpus `server/hub/tokens.ts` — 拡張対象の `TokenProvider`
- Cernere `server/src/project/service.ts` — `safeTableName` (4.4 の対象)
- Excubitor catalog `cernere_launch_credentials` — 資格情報の配布経路
