// LUDIARS service registry — `scripts/launch.ts` と `scripts/infisical.ts` の
// 共通カタログ。 `infra/PORT-MAP.md` ([[reference_ludiars_port_map]]) と
// Corpus discovery 既定 port (server/hub/discovery.ts) と同期させる。

export interface ServiceSpec {
  /** discover / 引数で使う ID。 manifest.service と一致させる。 */
  id: string;
  /** UI 表示用。 */
  displayName: string;
  /** Corpus repo からの相対パス (= LUDIARS root の sibling)。 */
  repoDir: string;
  /** `npm run <command>` を流す repo 内サブディレクトリ。 既定はリポジトリルート。 */
  subDir?: string;
  /** PORT-MAP 上のホスト port (loopback / shared infra 共通)。 */
  port: number;
  /** Cernere SSO への依存があるなら true。 起動順制御に使う。 */
  needsCernere: boolean;
  /** Infisical を経由するなら true (env-cli scripts を持つ)。 false 例: Corpus 本体は env-cli を持つが registry に書く意味は薄い */
  hasEnvCli: boolean;
  /** 説明 (CLI --list で出す)。 */
  note?: string;
}

export const SERVICES: ServiceSpec[] = [
  {
    id: 'cernere',
    displayName: 'Cernere (auth)',
    repoDir: '../Cernere',
    port: 5000,           // server。 frontend は別 port (Vite 5173 系)
    needsCernere: false,  // self
    hasEnvCli: true,
    note: 'OAuth + project token 発行。 他サービスの前提',
  },
  {
    id: 'memoria',
    displayName: 'Memoria',
    repoDir: '../Memoria',
    subDir: 'server',     // server/ 下に dev script がある
    port: 5180,
    needsCernere: true,
    hasEnvCli: true,
    note: 'Web bookmark + 日記 + dictionary',
  },
  {
    id: 'actio',
    displayName: 'Actio (タスク)',
    repoDir: '../Actio',
    port: 8888,
    needsCernere: true,
    hasEnvCli: true,
    note: 'タスク管理。 declarative β は /declarative.html (PR #130)',
  },
  {
    id: 'concordia',
    displayName: 'Concordia (multi-agent)',
    repoDir: '../Concordia',
    port: 17330,
    needsCernere: false,  // loopback only
    hasEnvCli: false,
    note: 'AI session coordinator (loopback only)',
  },
  {
    id: 'susurrus',
    displayName: 'Susurrus (chat)',
    repoDir: '../Susurrus',
    port: 17370,
    needsCernere: true,
    hasEnvCli: false,
    note: 'ローカルチャット daemon (loopback only)',
  },
  {
    id: 'quaestor',
    displayName: 'Quaestor (会計)',
    repoDir: '../Quaestor',
    port: 17400,
    needsCernere: false,
    hasEnvCli: false,
    note: '個人会計 (loopback only)',
  },
  {
    id: 'bibliotheca',
    displayName: 'Bibliotheca (貸出台帳)',
    repoDir: '../Bibliotheca',
    port: 17501,
    needsCernere: true,
    hasEnvCli: true,
    note: '本 / 機材 貸出。 declarative β は /declarative.html (PR #5)',
  },
  {
    id: 'aedilis',
    displayName: 'Aedilis (施設予約)',
    repoDir: '../Aedilis',
    port: 17502,
    needsCernere: true,
    hasEnvCli: true,
    note: '施設予約 + 日程登録。 Corpus pilot',
  },
  {
    id: 'custos',
    displayName: 'Custos (test runner)',
    repoDir: '../Custos',
    port: 17777,
    needsCernere: false,
    hasEnvCli: false,
    note: '遠隔テストランナー',
  },
];

/** id → spec で引く。 未知の id は null。 */
export function findService(id: string): ServiceSpec | null {
  return SERVICES.find((s) => s.id === id) ?? null;
}

/** id list を resolve。 `--all` は env-cli フラグで filter 可能。 */
export function resolveIds(
  args: readonly string[],
  opts: { requireEnvCli?: boolean } = {},
): { ids: string[]; unknown: string[] } {
  const filterFlag = opts.requireEnvCli ?? false;
  if (args.includes('--all')) {
    const all = SERVICES.filter((s) => !filterFlag || s.hasEnvCli).map((s) => s.id);
    return { ids: all, unknown: [] };
  }
  const ids: string[] = [];
  const unknown: string[] = [];
  for (const a of args) {
    if (a.startsWith('--')) continue;
    if (findService(a)) ids.push(a);
    else unknown.push(a);
  }
  return { ids, unknown };
}
