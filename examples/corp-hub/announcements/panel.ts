// お知らせパネル — 一覧 + (admin のみ) 投稿フォーム。

import {
  el,
  section,
  fmtDateTime,
  ensureStyles,
  showError,
  getJson,
  type PanelContext,
} from '../panel-kit.ts';

interface AnnouncementView {
  id: number;
  title: string;
  body: string;
  pinned: boolean;
  createdBy: string;
  createdAt: number;
}

export async function mount(container: HTMLElement, ctx: PanelContext): Promise<void> {
  ensureStyles();
  container.innerHTML = '';
  container.appendChild(el('h2', undefined, '📣 お知らせ'));

  const listHost = el('div');
  container.appendChild(listHost);

  if (ctx.identity.isAdmin) {
    container.appendChild(buildForm(ctx, () => void renderList(listHost, ctx)));
  }

  await renderList(listHost, ctx);
}

async function renderList(host: HTMLElement, ctx: PanelContext): Promise<void> {
  host.innerHTML = '';
  const wrap = section('最新のお知らせ');
  host.appendChild(wrap);

  const data = await getJson<{ items: AnnouncementView[] }>(ctx, '/');
  if (!data) {
    showError(wrap, 'お知らせを取得できませんでした');
    return;
  }
  if (data.items.length === 0) {
    wrap.appendChild(el('p', 'corp-meta', 'まだお知らせはありません'));
    return;
  }

  const list = el('ul', 'corp-list');
  for (const item of data.items) {
    const li = el('li', `corp-item${item.pinned ? ' pinned' : ''}`);
    li.appendChild(el('strong', undefined, `${item.pinned ? '📌 ' : ''}${item.title}`));
    if (item.body) li.appendChild(el('p', undefined, item.body));
    li.appendChild(el('div', 'corp-meta', fmtDateTime(item.createdAt)));
    if (ctx.identity.isAdmin || item.createdBy === ctx.identity.externalId) {
      const del = el('button', undefined, '削除');
      del.addEventListener('click', async () => {
        del.disabled = true;
        const res = await ctx.api(`/${item.id}`, { method: 'DELETE' }).catch(() => null);
        if (!res || !res.ok) {
          del.disabled = false;
          showError(li, '削除できませんでした');
          return;
        }
        await renderList(host, ctx);
      });
      li.appendChild(del);
    }
    list.appendChild(li);
  }
  wrap.appendChild(list);
}

function buildForm(ctx: PanelContext, onPosted: () => void): HTMLElement {
  const wrap = section('新規投稿 (admin)');
  const form = el('form', 'corp-form');

  const title = el('input');
  title.placeholder = 'タイトル';
  title.required = true;
  title.maxLength = 120;

  const body = el('textarea');
  body.placeholder = '本文';
  body.rows = 4;
  body.maxLength = 4_000;

  const pinnedLabel = el('label');
  const pinned = el('input');
  pinned.type = 'checkbox';
  pinnedLabel.append(pinned, document.createTextNode(' 上部に固定する'));

  const submit = el('button', undefined, '投稿');
  submit.type = 'submit';

  form.append(title, body, pinnedLabel, submit);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    submit.disabled = true;
    const res = await ctx.api('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: title.value, body: body.value, pinned: pinned.checked }),
    }).catch(() => null);
    submit.disabled = false;
    if (!res || !res.ok) {
      showError(form, '投稿できませんでした');
      return;
    }
    title.value = '';
    body.value = '';
    pinned.checked = false;
    onPosted();
  });

  wrap.appendChild(form);
  return wrap;
}
