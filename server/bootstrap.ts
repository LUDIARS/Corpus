import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { bootstrapCorpus } from './bootstrap-runtime.ts';

// import利用時はsignalをhostに任せ、起動失敗をawait import元へ返す。
const standalone = process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
const startup = bootstrapCorpus();
let stopping = false;
const detach = (): void => {
  process.off('SIGINT', stop);
  process.off('SIGTERM', stop);
};
const stop = (): void => {
  if (stopping) return;
  stopping = true;
  // 初期化途中でも確保完了を待って閉じる。startup側が失敗時cleanupを所有する。
  void startup.then((server) => server.close()).catch((error: unknown) => {
    console.error('[bootstrap] shutdown failed', error);
    process.exitCode = 1;
  }).finally(detach);
};
if (standalone) {
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
export const runtime = await startup.catch((error: unknown) => { detach(); throw error; });
