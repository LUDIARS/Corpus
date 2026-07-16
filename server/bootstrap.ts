/**
 * bootstrap entry — CLI args 解析 + Infisical 経由で env を確定してから本体を起動する。
 *
 * npm run dev / npm start はこのファイルを
 * `tsx --env-file-if-exists=.env.secrets --env-file-if-exists=.env` で起動する。
 *
 *   1. CLI args を解析し、 該当する CORPUS_* env vars を上書き (env / config より優先)
 *   2. tsx が .env.secrets (INFISICAL_*) と .env を process.env に読み込む
 *   3. ensureEnv() が Infisical から secret を fetch + inject (既存値は不変)
 *   4. index.ts を import して本体起動
 *
 * Infisical 創設情報が無い・到達不可でも throw しない。 index.ts 側で
 * env 不足を検出して落とすか degraded 起動するかを決める。
 *
 * ## CLI args (env と equivalent)
 *
 *   --port=<n>          CORPUS_PORT (既定 5185)
 *   --no-cernere        CORPUS_NO_AUTH=1 (Cernere 接続不要、 dev identity で起動)
 *   --services=<list>   CORPUS_SERVER_SERVICES (カンマ区切り baseUrl)
 *   --mode=<m>          CORPUS_MODE (server | local)
 *   --probe=<list>      CORPUS_LOCAL_PROBE_PORTS (カンマ区切り port)
 *   --plugin-dir=<p>    CORPUS_PLUGIN_DIR
 *   --public-url=<u>    CORPUS_PUBLIC_URL
 *
 * 例:
 *   npm run dev -- --no-cernere --port=5187
 *   npm run dev -- --mode=local --probe=17501,17502
 *   npm run dev -- --services=http://localhost:17501,http://localhost:17502
 */

import {
  ensureEnv,
  missingWantedKeys,
  hasInfisicalCreds,
} from './lib/env-bootstrap.ts';
import { installLogging } from './lib/logging.ts';

interface ArgSpec {
  flag: string;          // '--port'
  env: string;           // 'CORPUS_PORT'
  takesValue: boolean;   // true: --port=N or --port N / false: --no-cernere
  valueOnSet?: string;   // takesValue=false の代入値 (例: '1')
}

const ARG_SPECS: ArgSpec[] = [
  { flag: '--port',        env: 'CORPUS_PORT',                takesValue: true },
  { flag: '--no-cernere',  env: 'CORPUS_NO_AUTH',             takesValue: false, valueOnSet: '1' },
  { flag: '--services',    env: 'CORPUS_SERVER_SERVICES',     takesValue: true },
  { flag: '--mode',        env: 'CORPUS_MODE',                takesValue: true },
  { flag: '--probe',       env: 'CORPUS_LOCAL_PROBE_PORTS',   takesValue: true },
  { flag: '--plugin-dir',  env: 'CORPUS_PLUGIN_DIR',          takesValue: true },
  { flag: '--public-url',  env: 'CORPUS_PUBLIC_URL',          takesValue: true },
  // 継承先 (VantanHub 等) が「連携先は絶対固定」 にするための boot flag。
  // /api/hub/discovery PUT が 423 Locked を返すようになる。
  { flag: '--lock-discovery', env: 'CORPUS_DISCOVERY_LOCKED', takesValue: false, valueOnSet: '1' },
];

function parseArgsToEnv(argv: readonly string[]): void {
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    // --flag=value 形式
    const eq = arg.indexOf('=');
    const head = eq >= 0 ? arg.slice(0, eq) : arg;
    const spec = ARG_SPECS.find((s) => s.flag === head);
    if (!spec) continue;

    if (!spec.takesValue) {
      process.env[spec.env] = spec.valueOnSet ?? '1';
      continue;
    }

    let value: string | undefined;
    if (eq >= 0) {
      value = arg.slice(eq + 1);
    } else if (i + 1 < argv.length && !argv[i + 1]!.startsWith('--')) {
      value = argv[++i];
    }
    if (value !== undefined && value !== '') {
      process.env[spec.env] = value;
    }
  }
}

const main = async (): Promise<void> => {
  installLogging();
  parseArgsToEnv(process.argv.slice(2));

  // --no-cernere 時は WANTED_KEYS 警告 / index.ts の requireEnv を緩めるため、
  // 必須 env をプレースホルダで埋める (index.ts 側が NO_AUTH を見て本物の URL を
  // 使わないようにする)。
  if (process.env.CORPUS_NO_AUTH === '1') {
    if (!process.env.CERNERE_BASE_URL) process.env.CERNERE_BASE_URL = 'http://noauth.invalid';
    const port = process.env.CORPUS_PORT ?? '5185';
    if (!process.env.CORPUS_PUBLIC_URL) process.env.CORPUS_PUBLIC_URL = `http://localhost:${port}`;
    console.log('[bootstrap] --no-cernere: 認証 bypass モード (dev identity で起動)');
  }

  const result = await ensureEnv();
  if (result.reason === 'no_creds' && !hasInfisicalCreds()) {
    console.log('[bootstrap] INFISICAL_* creds 未設定 — .env / host env のみで起動');
  }
  const missing = missingWantedKeys();
  if (missing.length > 0) {
    console.warn(
      `[bootstrap] 未設定の WANTED_KEYS: ${missing.join(', ')} — 機能が degraded`,
    );
  }
  await import('./index.ts');
};

void main();
