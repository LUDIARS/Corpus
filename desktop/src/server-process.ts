import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { resolve } from 'node:path';

import type { DesktopConfig } from './config';

interface EmbeddedServerOptions {
  appRoot: string;
  dataDir: string;
  config: DesktopConfig;
}

export class EmbeddedCorpusServer {
  private process: ChildProcess | null = null;

  private constructor(
    readonly url: string,
    private readonly port: number,
    private readonly options: EmbeddedServerOptions,
  ) {}

  static async create(options: EmbeddedServerOptions): Promise<EmbeddedCorpusServer> {
    const requestedPort = parseRequestedPort(process.env.CORPUS_PORT);
    const port = requestedPort ?? await reserveLoopbackPort();
    return new EmbeddedCorpusServer(`http://127.0.0.1:${port}`, port, options);
  }

  start(): void {
    if (this.process) throw new Error('embedded Corpus server is already running');
    const runtimeRoot = resolve(this.options.appRoot, 'build', 'runtime');
    const serverEntry = resolve(runtimeRoot, 'server', 'bootstrap.mjs');
    const pluginDir = resolve(runtimeRoot, this.options.config.pluginPack);
    const publicDir = resolve(runtimeRoot, 'public');

    this.process = spawn(process.execPath, [serverEntry], {
      cwd: this.options.appRoot,
      shell: false,
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1',
        CORPUS_PORT: String(this.port),
        CORPUS_PUBLIC_URL: this.url,
        CORPUS_PUBLIC_DIR: publicDir,
        CORPUS_PLUGIN_DIR: pluginDir,
        CORPUS_DATA: this.options.dataDir,
        CORPUS_SERVICE_ID: this.options.config.serviceId,
        CORPUS_DISPLAY_NAME: this.options.config.productName,
        CORPUS_TOKEN_MODE: process.env.CORPUS_TOKEN_MODE ?? 'passthrough',
        ...(this.options.config.noAuth ? { CORPUS_NO_AUTH: '1' } : {}),
      },
      stdio: 'inherit',
      windowsHide: true,
    });
    this.process.once('exit', (code) => {
      console.log(`[corpus-desktop] embedded server exited: ${code}`);
      this.process = null;
    });
  }

  stop(): void {
    this.process?.kill('SIGTERM');
    this.process = null;
  }

  async waitUntilReady(timeoutMs = 30_000): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        const response = await fetch(`${this.url}/api/health`);
        if (response.ok) return true;
      } catch {
        // 起動完了まで再試行する。
      }
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 500));
    }
    return false;
  }
}

function parseRequestedPort(value: string | undefined): number | null {
  if (!value?.trim()) return null;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('CORPUS_PORT must be an integer between 1 and 65535');
  }
  return port;
}

async function reserveLoopbackPort(): Promise<number> {
  return new Promise((resolvePromise, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      if (!address || typeof address === 'string') {
        probe.close();
        reject(new Error('failed to allocate loopback port'));
        return;
      }
      const port = address.port;
      probe.close((error) => {
        if (error) reject(error);
        else resolvePromise(port);
      });
    });
  });
}
