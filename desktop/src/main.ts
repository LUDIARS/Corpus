// Corpus ローカルアプリ — Electron メインプロセス。
//
// 役割 (DESIGN.md §10):
//   - 内蔵 Corpus server を子プロセスで起動 (loopback 17520)
//   - frontend を BrowserWindow で表示する純クライアント
//   - タスクトレイ常駐 (ウィンドウ × はトレイへ最小化)
//
// 用途特化 hub (VantanHub 等) は、 この shell を出発点にマスコット窓や
// 最前面通知を足す。

import { app, BrowserWindow, Menu, Tray, ipcMain, nativeImage } from 'electron';
import { spawn, type ChildProcess } from 'node:child_process';
import { join, resolve } from 'node:path';

const SERVER_PORT = Number(process.env.CORPUS_PORT ?? 17520);
const SERVER_URL = `http://localhost:${SERVER_PORT}`;
const REPO_ROOT = resolve(__dirname, '..', '..');

let serverProc: ChildProcess | null = null;
let win: BrowserWindow | null = null;
let tray: Tray | null = null;
let quitting = false;

/** 内蔵 Corpus server を起動する。 */
function startServer(): void {
  serverProc = spawn('npm', ['start'], {
    cwd: REPO_ROOT,
    shell: true,
    env: {
      ...process.env,
      CORPUS_PORT: String(SERVER_PORT),
      CORPUS_PUBLIC_URL: SERVER_URL,
    },
    stdio: 'inherit',
  });
  serverProc.on('exit', (code) => {
    console.log(`[corpus-desktop] server exited: ${code}`);
    serverProc = null;
  });
}

/** server を含むプロセスツリーを止める (Windows は taskkill /T)。 */
function stopServer(): void {
  if (!serverProc?.pid) return;
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(serverProc.pid), '/T', '/F']);
  } else {
    serverProc.kill('SIGTERM');
  }
  serverProc = null;
}

/** /api/health が ok を返すまで待つ。 */
async function waitForServer(timeoutMs = 30_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${SERVER_URL}/api/health`);
      if (res.ok) return true;
    } catch {
      // まだ起動していない
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

function createWindow(): void {
  win = new BrowserWindow({
    width: 1100,
    height: 760,
    title: 'Corpus',
    backgroundColor: '#14161c',
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      sandbox: true,
      contextIsolation: true,
    },
  });
  void win.loadURL(SERVER_URL);
  win.on('close', (e) => {
    if (!quitting) {
      e.preventDefault();
      win?.hide();
    }
  });
}

function createTray(): void {
  // アイコンは scaffold では空 — 用途特化 hub が差し替える
  tray = new Tray(nativeImage.createEmpty());
  tray.setToolTip('Corpus');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Corpus を開く', click: () => win?.show() },
      { type: 'separator' },
      {
        label: 'Corpus を終了',
        click: () => {
          quitting = true;
          app.quit();
        },
      },
    ]),
  );
  tray.on('click', () => win?.show());
}

ipcMain.handle('corpus:server-url', () => SERVER_URL);
ipcMain.on('corpus:hide', () => win?.hide());
ipcMain.on('corpus:quit', () => {
  quitting = true;
  app.quit();
});

void app.whenReady().then(async () => {
  startServer();
  const ok = await waitForServer();
  createTray();
  createWindow();
  if (!ok) {
    win?.loadURL(
      'data:text/html,' +
        encodeURIComponent(
          '<body style="background:#14161c;color:#e7e9ee;font-family:sans-serif;padding:2rem">' +
          '<h2>Corpus server に接続できませんでした</h2>' +
          '<p>リポジトリ root の .env に CERNERE_BASE_URL 等が設定されているか確認してください。</p></body>',
        ),
    );
  }
});

app.on('window-all-closed', () => {
  // トレイ常駐なので明示終了まで生存
});

app.on('before-quit', () => {
  quitting = true;
  stopServer();
});
