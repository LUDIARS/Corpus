import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export interface DesktopConfig {
  productName: string;
  serviceId: string;
  pluginPack: string;
  noAuth: boolean;
  updateBaseUrl?: string;
}

export function loadDesktopConfig(
  appRoot: string,
  resourcesRoot: string,
): DesktopConfig {
  const explicitPath = process.env.CORPUS_DESKTOP_CONFIG?.trim();
  const configPath = explicitPath
    ? resolve(explicitPath)
    : [
        resolve(resourcesRoot, 'corpus.desktop.json'),
        resolve(appRoot, 'corpus.desktop.json'),
      ].find((candidate) => existsSync(candidate));
  // 既定値へ無言フォールバックしない。 既定に `noAuth` を含めると、 設定の同梱漏れが
  // そのまま「認証 bypass で起動」になる (fail-open)。 見つからなければ落とす。
  if (!configPath) {
    throw new Error(
      'corpus.desktop.json が見つかりません。 resourcesPath / appPath へ同梱するか ' +
        'CORPUS_DESKTOP_CONFIG でパスを指定してください。',
    );
  }

  const parsed = JSON.parse(readFileSync(configPath, 'utf8')) as Partial<DesktopConfig>;
  return {
    productName: requiredString(parsed.productName, 'productName'),
    serviceId: requiredString(parsed.serviceId, 'serviceId'),
    pluginPack: requiredString(parsed.pluginPack, 'pluginPack'),
    noAuth: parsed.noAuth === true,
    updateBaseUrl: optionalString(parsed.updateBaseUrl),
  };
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim().replace(/\/+$/, '') : undefined;
}

function requiredString(value: unknown, key: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`corpus.desktop.json: ${key} is required`);
  }
  return value.trim();
}
