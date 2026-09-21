import { app, BrowserWindow, Menu, Tray, dialog, ipcMain, nativeImage } from 'electron';
import { join } from 'node:path';

import { loadDesktopConfig } from './config';
import { EmbeddedCorpusServer } from './server-process';
import { configureAutoUpdate } from './auto-update';

let server: EmbeddedCorpusServer | null = null;
let window: BrowserWindow | null = null;
let tray: Tray | null = null;
let quitting = false;

function createWindow(serverUrl: string, title: string): BrowserWindow {
  const nextWindow = new BrowserWindow({
    width: 1100,
    height: 760,
    title,
    backgroundColor: '#14161c',
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      sandbox: true,
      contextIsolation: true,
    },
  });
  void nextWindow.loadURL(serverUrl);
  nextWindow.on('close', (event) => {
    if (!quitting) {
      event.preventDefault();
      nextWindow.hide();
    }
  });
  return nextWindow;
}

function createTray(title: string): Tray {
  const nextTray = new Tray(nativeImage.createEmpty());
  nextTray.setToolTip(title);
  nextTray.setContextMenu(Menu.buildFromTemplate([
    { label: `${title} を開く`, click: () => window?.show() },
    { type: 'separator' },
    {
      label: `${title} を終了`,
      click: () => {
        quitting = true;
        app.quit();
      },
    },
  ]));
  nextTray.on('click', () => window?.show());
  return nextTray;
}

ipcMain.handle('corpus:server-url', () => server?.url ?? null);
ipcMain.on('corpus:hide', () => window?.hide());
ipcMain.on('corpus:quit', () => {
  quitting = true;
  app.quit();
});

void app.whenReady().then(async () => {
  const config = loadDesktopConfig(app.getAppPath(), process.resourcesPath);
  configureAutoUpdate(config.updateBaseUrl);
  server = await EmbeddedCorpusServer.create({
    appRoot: app.getAppPath(),
    dataDir: app.getPath('userData'),
    config,
  });
  server.start();
  const ready = await server.waitUntilReady();
  tray = createTray(config.productName);
  window = createWindow(server.url, config.productName);
  if (!ready) {
    void window.loadURL(
      'data:text/html,' +
        encodeURIComponent(
          `<body style="background:#14161c;color:#e7e9ee;font-family:sans-serif;padding:2rem">` +
          `<h2>${config.productName} の内蔵サーバーに接続できませんでした</h2>` +
          '<p>アプリのログと corpus.desktop.json の設定を確認してください。</p></body>',
        ),
    );
  }
}).catch((error: unknown) => {
  // 設定不備 (corpus.desktop.json 不在等) を unhandled rejection のまま
  // 「窓もトレイも出ない」状態にしない。 理由を出して明示的に落とす。
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[corpus-desktop] 起動に失敗しました: ${message}`);
  dialog.showErrorBox('起動に失敗しました', message);
  quitting = true;
  server?.stop();
  app.exit(1);
});

app.on('window-all-closed', () => {
  // タスクトレイ常駐。終了はメニューまたは IPC から明示する。
});

app.on('before-quit', () => {
  quitting = true;
  server?.stop();
});
