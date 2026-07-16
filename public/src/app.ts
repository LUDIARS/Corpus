// Corpus frontend shell。
//
// 役割:
//   - Cernere トークンで認証 → /api/me
//   - /api/hub/modules でタブを構成 (組み込み "Overview" + プラグインモジュール)
//   - モジュールタブを開くと /plugins/<id>/<entry> を動的 import し mount() を呼ぶ
//
// ドメイン UI は一切持たない。 学校等の機能はプラグインの panel.js 側。

import { apiFetch, apiJson, AuthError, clearLegacyToken } from './api.ts';
import { mountCernereLogin } from './cernere-login.tsx';
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
import { renderPanel } from './render/renderer.ts';
import type { PanelDescriptor, RenderContext } from './render/types.ts';
import { readUiCache, writeUiCache } from './render/ui-cache.ts';

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

// ── §12.3 HMR ────────────────────────────────────────────────────────
// いま main に描いている declarative パネルを覚えておき、 そのサービス/UIキーの
// version が上がった (Corpus からの SSE) ら、 そのパネルだけ再描画する。
let currentDecl: { svcId: string; key: string; rerender: () => void } | null = null;
let hmrSource: EventSource | null = null;

function initHmr(): void {
  if (hmrSource) return;
  try {
    hmrSource = new EventSource('/ui-hmr');
    hmrSource.addEventListener('ui-changed', (ev) => {
      try {
        const { service, key } = JSON.parse((ev as MessageEvent).data) as {
          service: string;
          key: string;
        };
        if (currentDecl && currentDecl.svcId === service && currentDecl.key === key) {
          currentDecl.rerender();
          flashHmr(`↻ ${service}/${key} を更新`);
        }
      } catch {
        /* malformed event は無視 */
      }
    });
  } catch {
    /* EventSource 不可な環境 */
  }
}

function flashHmr(msg: string): void {
  const t = el('div', 'hmr-toast', msg);
  t.style.cssText =
    'position:fixed;right:12px;bottom:12px;background:#238636;color:#fff;' +
    'padding:.4rem .7rem;border-radius:8px;font-size:.8rem;z-index:9999;opacity:.95';
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 1600);
}

let unmountLogin: (() => void) | null = null;

function showLogin(message: string): void {
  unmountLogin?.();
  unmountLogin = null;
  app.innerHTML = '';
  const box = el('div', 'login');
  const mount = el('div', 'login-ui');
  box.appendChild(mount);
  app.appendChild(box);
  unmountLogin = mountCernereLogin(mount, message);
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

// panel に渡す fetch — apiFetch は 401 で AuthError を throw するが、
// パネルは res.status を自前で扱う (例: 503=未接続) ため throw しない薄い版。
async function apiFetchForPanel(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  return fetch(path, { ...init, credentials: 'same-origin' });
}

/** 参照サービス (Bb / Ae 等) の Corpus 用 UI パネルを表示する (D4 / §13)。 */
async function renderServicePanel(
  container: HTMLElement,
  svc: ServiceInfo,
  panel: ServicePanelInfo,
  identity: Identity,
): Promise<void> {
  container.innerHTML = '';
  if (panel.kind === 'declarative') {
    return renderDeclarativePanel(container, svc, panel, identity);
  }
  // script panel (旧来 D4) — entry の panel.js を動的 import して mount()
  if (!panel.entry) {
    container.appendChild(el('p', 'error', 'panel に entry がありません。'));
    return;
  }
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
    const entryPath = panel.entry.startsWith('/')
      ? panel.entry
      : `/corpus-ui/${panel.entry}`;
    const mod = (await import(
      /* @vite-ignore */ `/hub-ui/${svc.id}${entryPath}`
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

/** declarative panel — UI descriptor を Corpus 内蔵レンダラで描く (§13)。 */
async function renderDeclarativePanel(
  container: HTMLElement,
  svc: ServiceInfo,
  panel: ServicePanelInfo,
  identity: Identity,
): Promise<void> {
  // HMR (§12.3): このパネルを「いま描いている declarative」として記録。
  // SSE で version 変化が来たら rerender される。
  currentDecl = {
    svcId: svc.id,
    key: panel.id,
    rerender: () => void renderDeclarativePanel(container, svc, panel, identity),
  };
  let descriptor: PanelDescriptor | null = panel.ui ?? null;
  if (!descriptor && panel.uiEndpoint) {
    // §15.4 Vite-P1: WebStorage キャッシュ + ETag 条件付き取得。
    // 開いた時だけ fetch (= 遅延)、 2 回目以降は If-None-Match で再検証して
    // 304 ならキャッシュを再利用 (本文転送 0)。 HMR の rerender 時は内容が変わり
    // ETag も変わるので 200 で最新 descriptor を引き直す。
    const cached = readUiCache(svc.id, panel.id);
    try {
      const headers: Record<string, string> = {};
      if (cached) headers['if-none-match'] = cached.etag;
      // no-cache: ブラウザ HTTP cache を介さず必ずサーバへ再検証させ、 304 を JS に通す。
      const res = await apiFetchForPanel(`/hub-ui/${svc.id}${panel.uiEndpoint}`, {
        cache: 'no-cache',
        headers,
      });
      if (res.status === 304 && cached) {
        descriptor = cached.descriptor;
      } else if (res.ok) {
        descriptor = (await res.json()) as PanelDescriptor;
        const etag = res.headers.get('etag');
        if (etag) writeUiCache(svc.id, panel.id, { etag, descriptor });
      } else if (cached) {
        descriptor = cached.descriptor; // サーバ不調でもキャッシュで描画継続
      } else {
        throw new Error(`status ${res.status}`);
      }
    } catch (e) {
      if (cached) {
        descriptor = cached.descriptor; // ネットワーク不通 → キャッシュ fallback
      } else {
        container.appendChild(
          el('p', 'error', `UI descriptor の取得に失敗しました: ${String(e)}`),
        );
        return;
      }
    }
  }
  if (!descriptor) {
    container.appendChild(el('p', 'error', 'declarative panel に ui がありません。'));
    return;
  }
  const ctx: RenderContext = {
    identity: {
      userId: identity.userId,
      displayName: identity.displayName,
      isAdmin: identity.isAdmin,
    },
    data: (dataId, opts) => {
      const u = new URL(
        `/api/hub/data/${svc.id}/${encodeURIComponent(dataId)}`,
        location.origin,
      );
      for (const [k, v] of Object.entries(opts?.params ?? {})) {
        u.searchParams.set(`_cp_${k}`, v);
      }
      const init: RequestInit = { method: opts?.method ?? 'GET' };
      if (opts?.body !== undefined) {
        init.body = JSON.stringify(opts.body);
        init.headers = { 'content-type': 'application/json' };
      }
      return apiFetchForPanel(u.pathname + u.search, init);
    },
  };
  renderPanel(container, descriptor, ctx);
}

function renderShell(
  identity: Identity,
  modules: ModuleInfo[],
  services: ServiceInfo[],
): void {
  app.innerHTML = '';

  const header = el('header', 'topbar');
  header.appendChild(el('span', 'brand', 'Officina - GLab'));
  const who = el('span', 'who', identity.displayName ?? identity.userId);
  header.appendChild(who);
  const logout = el('button', 'ghost', 'ログアウト');
  logout.onclick = () => {
    void fetch('/auth/logout', { method: 'POST', credentials: 'same-origin' })
      .finally(() => {
        clearLegacyToken();
        showLogin('ログアウトしました。');
      });
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
    { id: '__overview', label: '🟢 ステータス', render: () => void renderOverview(main) },
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
    // HMR 追跡をリセット — declarative パネルが描かれたら自身で再設定する。
    currentDecl = null;
    tabs.find((t) => t.id === id)?.render();
  }
  for (const tab of tabs) {
    const btn = el('button', 'tab', tab.label);
    btn.onclick = () => activate(tab.id);
    buttons.set(tab.id, btn);
    nav.appendChild(btn);
  }
  activate('__overview');
  initHmr(); // §12.3 HMR の SSE 購読を開始
}

async function boot(): Promise<void> {
  clearLegacyToken();
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
      showLogin('セッションが切れました。 再度ログインしてください。');
    } else {
      app.innerHTML = '';
      app.appendChild(el('p', 'error', `起動に失敗しました: ${String(e)}`));
    }
  }
}

void boot();
