// Corpus frontend shell。
//
// 役割:
//   - Cernere トークンで認証 → /api/me
//   - /api/hub/modules でタブを構成 (組み込み "Overview" + プラグインモジュール)
//   - モジュールタブを開くと /plugins/<id>/<entry> を動的 import し mount() を呼ぶ
//
// ドメイン UI は一切持たない。 学校等の機能はプラグインの panel.js 側。

import { apiFetch, apiJson, AuthError, clearToken, getToken, loginRedirect } from './api.ts';
import type {
  HubOverview,
  Identity,
  ModuleInfo,
  PanelContext,
  PanelModule,
  ServiceInfo,
  ServicePanelContext,
  ServicePanelInfo,
  ServicePanelModule,
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

/** 1 サービスのカード — マニフェスト宣言済みデータを取得して表示する。 */
function renderServiceCard(container: HTMLElement, svc: ServiceInfo): void {
  if (!svc.manifest) return;
  const card = el('div', 'service-card');
  const head = el('div', 'service-head');
  head.appendChild(el('strong', undefined, svc.manifest.displayName));
  head.appendChild(el('span', `badge badge-scope-${svc.scope}`, svc.scope));
  head.appendChild(el('span', 'muted', ` v${svc.manifest.version}`));
  card.appendChild(head);

  if (svc.manifest.data.length === 0) {
    card.appendChild(el('p', 'muted', '(集約データの宣言なし)'));
  }
  for (const d of svc.manifest.data) {
    const row = el('div', 'service-data-row');
    const btn = el('button', 'ghost', `${d.title} を取得`);
    const out = el('pre', 'service-data-out');
    out.style.display = 'none';
    btn.onclick = async () => {
      btn.disabled = true;
      out.style.display = 'block';
      out.textContent = '取得中…';
      try {
        const res = await apiFetch(`/api/hub/data/${svc.id}/${d.id}`);
        const text = await res.text();
        out.textContent = res.ok
          ? text
          : `(${res.status}) ${text}`;
      } catch (e) {
        out.textContent = `取得に失敗: ${String(e)}`;
      } finally {
        btn.disabled = false;
      }
    };
    row.appendChild(btn);
    card.appendChild(row);
    card.appendChild(out);
  }
  container.appendChild(card);
}

async function renderOverview(container: HTMLElement): Promise<void> {
  container.innerHTML = '';
  container.appendChild(el('p', 'muted', '読み込み中…'));
  try {
    const ov = await apiJson<HubOverview>('/api/hub/overview');
    const { services } = await apiJson<{ services: ServiceInfo[] }>(
      '/api/hub/services',
    );
    container.innerHTML = '';
    container.appendChild(
      el(
        'p',
        'muted',
        `稼働 ${ov.counts.up} / 一部 ${ov.counts.degraded} / 停止 ${ov.counts.down}`,
      ),
    );
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
        const badge = el(
          'span',
          `badge badge-${conn.health.status}`,
          HEALTH_LABEL[conn.health.status] ?? conn.health.status,
        );
        li.appendChild(badge);
        li.appendChild(el('span', 'connector-title', conn.title));
        if (conn.health.detail) {
          li.appendChild(el('span', 'muted', ` — ${conn.health.detail}`));
        }
        ul.appendChild(li);
      }
      container.appendChild(ul);
    }

    // 参照サービスのデータ (マニフェスト公開サービス)
    container.appendChild(el('h3', undefined, '参照サービスのデータ'));
    const withManifest = services.filter((s) => s.manifest);
    if (withManifest.length === 0) {
      container.appendChild(
        el('p', 'muted', '(マニフェストを公開しているサービスはありません)'),
      );
    }
    for (const svc of withManifest) renderServiceCard(container, svc);
  } catch (e) {
    container.innerHTML = '';
    container.appendChild(el('p', 'error', `集約に失敗: ${String(e)}`));
  }
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

/** 参照サービス (Bb / Ae 等) の Corpus 用 UI コンポーネントを表示する (D4)。 */
async function renderServicePanel(
  container: HTMLElement,
  svc: ServiceInfo,
  panel: ServicePanelInfo,
  identity: Identity,
): Promise<void> {
  container.innerHTML = '';
  const ctx: ServicePanelContext = {
    service: svc.id,
    identity,
    data: (dataId, init) =>
      apiFetchForPanel(
        `/api/hub/data/${svc.id}/${encodeURIComponent(dataId)}`,
        init,
      ),
  };
  try {
    // entry はファイル名 (manifest が /corpus-ui/<entry> で配信する想定)
    const file = panel.entry.split('/').pop() ?? panel.entry;
    const mod = (await import(
      /* @vite-ignore */ `/hub-ui/${svc.id}/${file}`
    )) as ServicePanelModule;
    if (typeof mod.mount !== 'function') {
      throw new Error('サービスパネルが mount() を export していません');
    }
    await mod.mount(container, ctx);
  } catch (e) {
    container.innerHTML = '';
    container.appendChild(
      el('p', 'error', `サービスパネルの読み込みに失敗しました: ${String(e)}`),
    );
  }
}

function renderShell(
  identity: Identity,
  modules: ModuleInfo[],
  services: ServiceInfo[],
): void {
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
    { id: '__overview', label: '🏠 概況', render: () => void renderOverview(main) },
    ...modules.map((m) => ({
      id: m.id,
      label: `${m.icon ?? '▫'} ${m.title}`,
      render: () => void renderModulePanel(main, m, identity),
    })),
    // 参照サービスが提供する Corpus 用 UI パネル (D4)
    ...services.flatMap((svc) =>
      (svc.manifest?.panels ?? []).map((panel) => ({
        id: `svc:${svc.id}:${panel.id}`,
        label: `${panel.icon ?? '🧩'} ${panel.title}`,
        render: () => void renderServicePanel(main, svc, panel, identity),
      })),
    ),
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
    const { services } = await apiJson<{ services: ServiceInfo[] }>(
      '/api/hub/services',
    );
    renderShell(identity, modules, services);
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
