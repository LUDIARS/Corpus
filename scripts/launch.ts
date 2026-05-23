// scripts/launch — 指定した LUDIARS サービスを並列起動する dev utility。
//
// Usage:
//   npx tsx scripts/launch.ts --list                  # 知ってるサービス一覧
//   npx tsx scripts/launch.ts bibliotheca aedilis     # 2 サービスを並列起動
//   npx tsx scripts/launch.ts --all                   # 全 services
//   npx tsx scripts/launch.ts --with-cernere bibliotheca
//                                                     # Cernere を先頭に挿入
//
// 各サービスの stdout/stderr は `[<id>] ...` でプリフィックス付け表示。
// Ctrl+C で全プロセス kill。 1 サービスがクラッシュしても他は継続する。
//
// 各サービスは `<repoDir>/<subDir?>` で `npm run dev` を実行する。 dev script
// が無いサービスは failure を 1 行 log して skip。

import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { SERVICES, findService, resolveIds } from './services.ts';

interface Options {
  withCernere: boolean;
  list: boolean;
  ids: string[];
  unknown: string[];
}

function parseArgs(argv: readonly string[]): Options {
  const opts: Options = { withCernere: false, list: false, ids: [], unknown: [] };
  if (argv.includes('--help') || argv.includes('-h')) {
    printUsage();
    process.exit(0);
  }
  if (argv.includes('--list')) {
    opts.list = true;
    return opts;
  }
  opts.withCernere = argv.includes('--with-cernere');
  const { ids, unknown } = resolveIds(argv);
  opts.ids = ids;
  opts.unknown = unknown;
  return opts;
}

function printUsage(): void {
  console.log(`Usage:
  npx tsx scripts/launch.ts --list
  npx tsx scripts/launch.ts <id...> [--with-cernere]
  npx tsx scripts/launch.ts --all

Options:
  --list           known service ID と port を一覧
  --all            registry の全サービスを並列起動
  --with-cernere   依存解決: cernere を先頭に挿入 (needsCernere=true サービスがあるとき推奨)
  --help, -h       これを表示

LUDIARS service registry: scripts/services.ts`);
}

function listAll(): void {
  console.log('id              port    needs-cernere  desc');
  console.log('--              ----    -------------  ----');
  for (const s of SERVICES) {
    const id = s.id.padEnd(15);
    const port = String(s.port).padEnd(7);
    const nc = (s.needsCernere ? 'yes' : 'no ').padEnd(14);
    console.log(`${id} ${port} ${nc} ${s.note ?? ''}`);
  }
}

function startOne(id: string): ChildProcess | null {
  const spec = findService(id);
  if (!spec) return null;
  const dir = resolve(process.cwd(), spec.repoDir, spec.subDir ?? '.');
  if (!existsSync(dir)) {
    console.error(`[${id}] repo dir 不在: ${dir} — skip`);
    return null;
  }
  if (!existsSync(join(dir, 'package.json'))) {
    console.error(`[${id}] package.json 不在: ${dir} — skip`);
    return null;
  }

  const proc = spawn('npm', ['run', 'dev'], {
    cwd: dir,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: true,
  });
  const prefix = `[${id.padEnd(11)}]`;
  proc.stdout?.on('data', (chunk: Buffer) => {
    for (const line of chunk.toString().split('\n')) {
      if (line) process.stdout.write(`${prefix} ${line}\n`);
    }
  });
  proc.stderr?.on('data', (chunk: Buffer) => {
    for (const line of chunk.toString().split('\n')) {
      if (line) process.stderr.write(`${prefix} ${line}\n`);
    }
  });
  proc.on('exit', (code, signal) => {
    process.stderr.write(`${prefix} exited (code=${code} signal=${signal})\n`);
  });
  process.stdout.write(`${prefix} starting (cwd=${dir}, port=${spec.port})\n`);
  return proc;
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.list) {
    listAll();
    return;
  }
  if (opts.unknown.length) {
    console.error(`unknown service IDs: ${opts.unknown.join(', ')}`);
    console.error(`--list で確認してください`);
    process.exit(2);
  }
  if (!opts.ids.length) {
    printUsage();
    process.exit(2);
  }

  // --with-cernere: cernere を先頭に挿入 (重複は除外)
  let ids = [...opts.ids];
  if (opts.withCernere && !ids.includes('cernere')) {
    ids = ['cernere', ...ids];
  }

  console.log(`[launch] 起動対象: ${ids.join(', ')}`);
  const procs: ChildProcess[] = [];
  for (const id of ids) {
    const p = startOne(id);
    if (p) procs.push(p);
  }
  if (!procs.length) {
    console.error('[launch] 起動できたサービスがありません');
    process.exit(1);
  }

  // Cleanup: SIGINT / SIGTERM で全部 kill
  const shutdown = (sig: NodeJS.Signals): void => {
    console.log(`\n[launch] ${sig} 受信 — 全サービス停止`);
    for (const p of procs) {
      try { p.kill('SIGINT'); } catch { /* ignore */ }
    }
    setTimeout(() => process.exit(0), 1000);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  // Keep the orchestrator alive while children run。
  // 全プロセス exit したら orchestrator も終了。
  let remaining = procs.length;
  for (const p of procs) {
    p.on('exit', () => {
      remaining--;
      if (remaining === 0) {
        console.log('[launch] 全サービスが停止しました');
        process.exit(0);
      }
    });
  }
}

void main();
