// Corpus ローカルアプリ preload。 sandbox + contextBridge で最小 API を露出する。

import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('corpus', {
  /** 内蔵 Corpus server の listen URL を返す。 */
  getServerUrl: (): Promise<string> => ipcRenderer.invoke('corpus:server-url'),
  /** ウィンドウをトレイに隠す。 */
  hide: (): void => ipcRenderer.send('corpus:hide'),
  /** 完全終了する。 */
  quit: (): void => ipcRenderer.send('corpus:quit'),
});
