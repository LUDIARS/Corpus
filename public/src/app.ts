// Corpus frontend shell。
//
// 役割:
//   - Cernere トークンで認証 → /api/me
//   - /api/hub/modules でタブを構成 (組み込み "Overview" + プラグインモジュール)
//   - モジュールタブを開くと /plugins/<id>/<entry> を動的 import し mount() を呼ぶ
//
// ドメイン UI は一切持たない。 学校等の機能はプラグインの panel.js 側。

import { apiJson, AuthError, clearToken, getToken, loginRedirect } from './api.ts';
import type {
  HubOverview,
  Identity,
  ModuleInfo,
  PanelContext,
  PanelModule,
} from './types.ts';

const app = document.getElementById('app') as HTMLElement;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
}

function showLogin(message: string): void {
  app.innerHTML = '';
  const box = el('div', 'login');
  box.appendChild(el('h1', undefined, 'Corpus'));
  box.appendChild(el('p', 'muted', message));
  const btn = el('button', 'primary', 'Cernere でログイン');
  btn.onclick = () => void loginRedirect();
  box.appendChild(btn);
  app.appendChild(box);
}

const HEALTH_LABEL: Record<string, string> = {
  up: '稼働',
  degraded: '一部',
  down: '停止',
};

function renderOverview(container: HTMLElement): void {
  container.innerHTML = '';
  container.appendChild(el('p', 'muted', 'コネクタの死活を確認しています…'));
  void apiJson<HubOverview>('/api/hub/overview')
    .then((ov) => {
      container.innerHTML = '';
      const summary = el(
        'p',
        'muted',
        `稼働 ${ov.counts.up} / 一部 ${ov.counts.degraded} / 停止 ${ov.counts.down}`,
      );
      container.appendChild(summary);
      for (const [label, list] of [
        ['ローカル (この PC のサービス)', ov.local],
        ['マルチ (サーバ集約)', ov.multi],
      ] as const) {
        container.appendChild(el('h3', undefined, label));
        if (list.length === 0) {
          container.appendChild(el('p', 'muted', '(コネクタなし)'));
          continue;
        }
        const ul = el('ul', 'connector-list');
        for (const conn of list) {
          const li = el('li');
          const badge = el('span', `badge badge-${conn.health.status}`,
            HEALTH_LABEL[conn.health.status] ?? conn.health.status);
          li.appendChild(badge);
          li.appendChild(el('span', 'connector-title', conn.title));
          if (conn.health.detail) {
            li.appendChild(el('span', 'muted', ` — ${conn.health.detail}`));
          }
          ul.appendChild(li);
        }
        container.appendChild(ul);
      }
    })
    .catch((e) => {
      container.innerHTML = '';
      container.appendChild(el('p', 'error', `集約に失敗: ${String(e)}`));
    });
}

async function renderModulePanel(
  container: HTMLElement,
  mod: ModuleInfo,
  identity: Identity,
): Promise<void> {
  container.innerHTML = '';
  if (!mod.panel) {
    container.appendChild(
      el('p', 'muted', 'このモジュールは表示パネルを提供していません。'),
    );
    return;
  }
  const ctx: PanelContext = {
    moduleId: mod.id,
    identity,
    api: (path, init) =>
      apiFetchForPanel(`/api/x/${mod.id}${path.startsWith('/') ? '' : '/'}${path}`, init),
    hubApi: (path, init) => apiFetchForPanel(path, init),
  };
  try {
    const url = `/plugins/${mod.id}/${mod.panel.entry}`;
    const panel = (await import(/* @vite-ignore */ url)) as PanelModule;
    if (typeof panel.mount !== 'function') {
      throw new Error('panel.js が mount() を export していません');
    }
    await panel.mount(container, ctx);
  } catch (e) {
    container.innerHTML = '';
    container.appendChild(
      el('p', 'error', `パネルの読み込みに失敗しました: ${String(e)}`),
    );
  }
}

// panel に渡す fetch — api.ts の apiFetch を import すると循環するので薄く再実装
async function apiFetchForPanel(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const token = getToken();
  const headers = new Headers(init.headers);
  if (token) headers.set('authorization', `Bearer ${token}`);
  return fetch(path, { ...init, headers });
}

function renderShell(identity: Identity, modules: ModuleInfo[]): void {
  app.innerHTML = '';

  const header = el('header', 'topbar');
  header.appendChild(el('span', 'brand', 'Corpus'));
  const who = el('span', 'who', identity.displayName ?? identity.userId);
  header.appendChild(who);
  const logout = el('button', 'ghost', 'ログアウト');
  logout.onclick = () => {
    clearToken();
    showLogin('ログアウトしました。');
  };
  header.appendChild(logout);
  app.appendChild(header);

  const layout = el('div', 'layout');
  const nav = el('nav', 'tabs');
  const main = el('main', 'panel');
  layout.appendChild(nav);
  layout.appendChild(main);
  app.appendChild(layout);

  type Tab = { id: string; label: string; render: () => void };
  const tabs: Tab[] = [
    { id: '__overview', label: '🏠 概況', render: () => renderOverview(main) },
    ...modules.map((m) => ({
      id: m.id,
      label: `${m.icon ?? '▫'} ${m.title}`,
      render: () => void renderModulePanel(main, m, identity),
    })),
  ];

  const buttons = new Map<string, HTMLButtonElement>();
  function activate(id: string): void {
    for (const [tid, btn] of buttons) btn.classList.toggle('active', tid === id);
    tabs.find((t) => t.id === id)?.render();
  }
  for (const tab of tabs) {
    const btn = el('button', 'tab', tab.label);
    btn.onclick = () => activate(tab.id);
    buttons.set(tab.id, btn);
    nav.appendChild(btn);
  }
  activate('__overview');
}

async function boot(): Promise<void> {
  if (!getToken()) {
    showLogin('Cernere でログインしてください。');
    return;
  }
  try {
    const identity = await apiJson<Identity>('/api/me');
    const { modules } = await apiJson<{ modules: ModuleInfo[] }>(
      '/api/hub/modules',
    );
    renderShell(identity, modules);
  } catch (e) {
    if (e instanceof AuthError) {
      clearToken();
      showLogin('セッションが切れました。 再度ログインしてください。');
    } else {
      app.innerHTML = '';
      app.appendChild(el('p', 'error', `起動に失敗しました: ${String(e)}`));
    }
  }
}

void boot();
