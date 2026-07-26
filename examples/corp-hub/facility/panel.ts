// 施設パネル — Aedilis の施設一覧を中継表示する。 未接続なら degraded 表示。

import {
  el,
  section,
  ensureStyles,
  showError,
  getJson,
  type PanelContext,
} from '../panel-kit.ts';

interface FacilityView {
  id?: string;
  name?: string;
  location?: string;
  capacity?: number;
}

interface FacilitiesResponse {
  items?: FacilityView[];
  connected?: boolean;
  detail?: string;
}

interface HealthView {
  status: 'up' | 'down' | 'degraded';
  detail?: string;
}

export async function mount(container: HTMLElement, ctx: PanelContext): Promise<void> {
  ensureStyles();
  container.innerHTML = '';
  container.appendChild(el('h2', undefined, '🏢 施設'));

  const wrap = section('会議室・設備 (Aedilis)');
  container.appendChild(wrap);

  const health = await getJson<HealthView>(ctx, '/health');
  if (health && health.status !== 'up') {
    wrap.appendChild(el('p', 'corp-meta', `接続状態: ${health.status} — ${health.detail ?? ''}`));
  }

  const data = await getJson<FacilitiesResponse>(ctx, '/facilities');
  if (!data) {
    showError(wrap, '施設一覧を取得できませんでした (接続先が未稼働の可能性があります)');
    return;
  }
  if (data.connected === false) {
    wrap.appendChild(el('p', 'corp-meta', `未接続: ${data.detail ?? '接続先が設定されていません'}`));
    return;
  }

  const items = data.items ?? [];
  if (items.length === 0) {
    wrap.appendChild(el('p', 'corp-meta', '登録されている施設がありません'));
    return;
  }

  const list = el('ul', 'corp-list');
  for (const facility of items) {
    const li = el('li', 'corp-item');
    li.appendChild(el('strong', undefined, facility.name ?? facility.id ?? '(名称不明)'));
    const meta = [facility.location, facility.capacity ? `定員 ${facility.capacity}` : null]
      .filter((v): v is string => Boolean(v))
      .join(' · ');
    if (meta) li.appendChild(el('div', 'corp-meta', meta));
    list.appendChild(li);
  }
  wrap.appendChild(list);
}
