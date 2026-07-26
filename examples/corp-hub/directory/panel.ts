// 名簿パネル — 自分の identity + この Hub が見たことのある人の一覧 (キャッシュ)。

import {
  el,
  section,
  fmtDateTime,
  ensureStyles,
  showError,
  getJson,
  type PanelContext,
} from '../panel-kit.ts';

interface MeView {
  externalId: string;
  displayName: string | null;
  isAdmin: boolean;
  profileSource: string;
}

interface MemberView {
  externalId: string;
  displayName: string;
  seenAt: number;
}

interface StaleView extends MemberView {
  daysSinceSeen: number;
}

const STALE_PRESETS = [30, 90, 180] as const;
const STALE_DEFAULT_DAYS = 90;

export async function mount(container: HTMLElement, ctx: PanelContext): Promise<void> {
  ensureStyles();
  container.innerHTML = '';
  container.appendChild(el('h2', undefined, '👥 名簿'));

  const meHost = el('div');
  const membersHost = el('div');
  const staleHost = el('div');
  container.append(meHost, membersHost, staleHost);

  const work = [renderMe(meHost, ctx), renderMembers(membersHost, ctx)];
  // 棚卸しは admin だけに出す (API 側も admin_only で二重に閉じている)。
  if (ctx.identity.isAdmin) work.push(renderStale(staleHost, ctx, STALE_DEFAULT_DAYS));
  await Promise.all(work);
}

async function renderMe(host: HTMLElement, ctx: PanelContext): Promise<void> {
  const wrap = section('自分');
  host.appendChild(wrap);

  const me = await getJson<MeView>(ctx, '/me');
  if (!me) {
    showError(wrap, '自分の情報を取得できませんでした');
    return;
  }
  const item = el('div', 'corp-item');
  item.appendChild(el('strong', undefined, me.displayName ?? '(表示名なし)'));
  item.appendChild(el('div', 'corp-meta', `external-id: ${me.externalId}`));
  item.appendChild(el('div', 'corp-meta', me.isAdmin ? '権限: admin' : '権限: member'));
  item.appendChild(el(
    'div',
    'corp-meta',
    `氏名・部署・役職の正本は ${me.profileSource} (この Hub には複製しない)`,
  ));
  wrap.appendChild(item);
}

async function renderStale(
  host: HTMLElement,
  ctx: PanelContext,
  days: number,
): Promise<void> {
  host.innerHTML = '';
  const wrap = section(`${days} 日ログインなし (棚卸し候補)`);
  host.appendChild(wrap);

  // しきい値の切り替え。 押すたびに再取得する。
  const picker = el('div', 'corp-meta');
  for (const preset of STALE_PRESETS) {
    const button = el('button', undefined, `${preset}日`);
    button.disabled = preset === days;
    button.addEventListener('click', () => void renderStale(host, ctx, preset));
    picker.appendChild(button);
  }
  wrap.appendChild(picker);

  const data = await getJson<{ items: StaleView[] }>(ctx, `/stale?days=${days}`);
  if (!data) {
    showError(wrap, '棚卸しリストを取得できませんでした');
    return;
  }
  if (data.items.length === 0) {
    wrap.appendChild(el('p', 'corp-meta', `${days} 日以上アクセスの無い人はいません`));
    return;
  }

  const list = el('ul', 'corp-list');
  for (const member of data.items) {
    const li = el('li', 'corp-item');
    li.appendChild(el('strong', undefined, member.displayName));
    li.appendChild(el(
      'div',
      'corp-meta',
      `最終アクセス ${fmtDateTime(member.seenAt)} (${member.daysSinceSeen} 日前)`,
    ));
    li.appendChild(el('div', 'corp-meta', `external-id: ${member.externalId}`));
    list.appendChild(li);
  }
  wrap.appendChild(list);
  wrap.appendChild(el(
    'p',
    'corp-meta',
    '退職者の削除は Cernere 側 (edge_idp.purge_user) で行います。'
    + ' この一覧はこの Hub への最終アクセスに基づく候補です。',
  ));
}

async function renderMembers(host: HTMLElement, ctx: PanelContext): Promise<void> {
  const wrap = section('この Hub が見たことのある人');
  host.appendChild(wrap);

  const data = await getJson<{ items: MemberView[]; source: string }>(ctx, '/members');
  if (!data) {
    showError(wrap, '名簿を取得できませんでした');
    return;
  }
  wrap.appendChild(el(
    'p',
    'corp-meta',
    '全社員名簿ではなく表示名キャッシュです。 正本は Cernere にあります。',
  ));
  if (data.items.length === 0) {
    wrap.appendChild(el('p', 'corp-meta', 'まだ誰も記録されていません'));
    return;
  }

  const list = el('ul', 'corp-list');
  for (const member of data.items) {
    const li = el('li', 'corp-item');
    li.appendChild(el('strong', undefined, member.displayName));
    li.appendChild(el('div', 'corp-meta', `最終確認 ${fmtDateTime(member.seenAt)}`));
    list.appendChild(li);
  }
  wrap.appendChild(list);
}
