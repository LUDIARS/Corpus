import { app } from 'electron';
import {
  updateElectronApp,
  UpdateSourceType,
} from 'update-electron-app';

export function configureAutoUpdate(updateBaseUrl: string | undefined): void {
  if (!app.isPackaged || !updateBaseUrl) return;
  updateElectronApp({
    updateSource: {
      type: UpdateSourceType.StaticStorage,
      baseUrl: `${updateBaseUrl}/${process.platform}/${process.arch}`,
    },
  });
}
