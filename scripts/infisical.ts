// scripts/infisical — 各 LUDIARS サービスの env-cli (Infisical) 操作を一括実行。
//
// Usage:
//   npx tsx scripts/infisical.ts <op> <id...> [--all]
//
// op:
//   setup       初回 Infisical machine identity 設定 (対話)
//   test        現状の secret 取得テスト
//   gen         .env 生成
//   initialize  デフォルト値を Infisical に登録
//   list        現状の env 値を一覧
//   get <key>   1 つ取得
//   set <key=v> 1 つ設定
//
// 例:
//   npx tsx scripts/infisical.ts gen bibliotheca aedilis    # 2 サービスで env:gen
//   npx tsx scripts/infisical.ts initialize --all           # env-cli 持つ全 service で初期値登録
//   npx tsx scripts/infisical.ts list memoria               # Memoria の env list
//
// 各サービスは `<repoDir>/<subDir?>` で `npm run env:<op>` を順次実行 (並列ではなく
// 直列、 対話プロンプトを取り違えないため)。 失敗があっても次のサービスに進む。

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { SERVICES, findService, resolveIds } from './services.ts';

const VALID_OPS = ['setup', 'test', 'gen', 'list', 'get', 'set', 'initialize'] as const;
type Op = (typeof VALID_OPS)[number];

function printUsage(): void {
  console.log(`Usage:
  npx tsx scripts/infisical.ts <op> <id...> [--all]
  npx tsx scripts/infisical.ts <op> get|set <key|key=value> <id...>

op: ${VALID_OPS.join(' | ')}

Options:
  --all      env-cli を持つ全 service を対象 (hasEnvCli=true)
  --help     これを表示

例:
  npx tsx scripts/infisical.ts gen bibliotheca aedilis
  npx tsx scripts/infisical.ts initialize --all
  npx tsx scripts/infisical.ts list memoria

env-cli は ../Cernere/packages/env-cli の cli.ts を各サービスが呼ぶ wrapper。
op 文字列はそのまま \`npm run env:<op>\` に渡される。`);
}

function main(): void {
  const argv = process.argv.slice(2);
  if (argv.includes('--help') || argv.length === 0) {
    printUsage();
    process.exit(argv.length === 0 ? 2 : 0);
  }

  const op = argv[0] as Op;
  if (!VALID_OPS.includes(op)) {
    console.error(`unknown op: ${op}`);
    printUsage();
    process.exit(2);
  }

  // op が get/set のときは次の引数を key/value として握って渡す。
  // それ以外は id list。
  let opArg: string | null = null;
  let restStart = 1;
  if (op === 'get' || op === 'set') {
    opArg = argv[1] ?? null;
    restStart = 2;
    if (!opArg) {
      console.error(`${op} には key${op === 'set' ? '=value' : ''} 引数が必要です`);
      process.exit(2);
    }
  }
  const rest = argv.slice(restStart);

  const { ids, unknown } = resolveIds(rest, { requireEnvCli: rest.includes('--all') });
  if (unknown.length) {
    console.error(`unknown service IDs: ${unknown.join(', ')}`);
    console.error(`npx tsx scripts/launch.ts --list で確認できます`);
    process.exit(2);
  }
  if (!ids.length) {
    console.error('対象サービスがありません');
    printUsage();
    process.exit(2);
  }

  let failed = 0;
  for (const id of ids) {
    const spec = findService(id);
    if (!spec) continue;
    if (!spec.hasEnvCli) {
      console.warn(`[${id}] hasEnvCli=false — skip`);
      continue;
    }
    const dir = resolve(process.cwd(), spec.repoDir, spec.subDir ?? '.');
    if (!existsSync(join(dir, 'package.json'))) {
      console.error(`[${id}] package.json 不在 (${dir}) — skip`);
      failed++;
      continue;
    }

    console.log(`\n=== [${id}] ${spec.displayName}  env:${op}${opArg ? ` ${opArg}` : ''} ===`);
    const args = ['run', `env:${op}`];
    if (opArg) {
      // npm run script -- arg 形式で渡す
      args.push('--', opArg);
    }
    const r = spawnSync('npm', args, {
      cwd: dir,
      stdio: 'inherit',
      shell: true,
    });
    if (r.status !== 0) {
      console.error(`[${id}] env:${op} 失敗 (exit ${r.status})`);
      failed++;
    }
  }

  if (failed) {
    console.error(`\n[infisical] ${failed}/${ids.length} サービスが失敗しました`);
    process.exit(1);
  }
  console.log(`\n[infisical] 完了 (${ids.length} サービス)`);
}

main();
