// テンプレート束縛 (Corpus DESIGN.md §13.5)。
//
// `{field}` / `{field|filter}` をレコード値で置換する純粋関数群。
// DOM には触らない (触るのは各 component)。

export function getByPath(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const seg of path.split('.')) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur;
}

export function extractArray(json: unknown, itemsPath?: string): Record<string, unknown>[] {
  const v = itemsPath ? getByPath(json, itemsPath) : json;
  return Array.isArray(v) ? (v as Record<string, unknown>[]) : [];
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function applyFilter(raw: unknown, filter: string): string {
  if (raw == null || raw === '') return '';
  if (filter.startsWith('truncate:')) {
    const n = Number(filter.slice(9)) || 20;
    const s = String(raw);
    return s.length > n ? `${s.slice(0, n)}…` : s;
  }
  if (filter === 'number') return String(Number(raw));
  if (filter === 'datetime' || filter === 'date' || filter === 'time') {
    const d = new Date(typeof raw === 'number' ? raw : String(raw));
    if (Number.isNaN(d.getTime())) return String(raw);
    const ymd = `${d.getFullYear()}/${pad2(d.getMonth() + 1)}/${pad2(d.getDate())}`;
    const hm = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
    if (filter === 'date') return ymd;
    if (filter === 'time') return hm;
    return `${ymd} ${hm}`;
  }
  return String(raw);
}

/** `{field}` / `{field|filter}` をレコード値で置換。 */
export function applyTemplate(tmpl: string, record: Record<string, unknown>): string {
  return tmpl.replace(/\{([^}|]+)(?:\|([^}]+))?\}/g, (_m, field: string, filter?: string) => {
    const raw = getByPath(record, field.trim());
    if (raw == null) return '';
    return filter ? applyFilter(raw, filter.trim()) : String(raw);
  });
}

export function fillParams(
  spec: Record<string, string> | undefined,
  record: Record<string, unknown>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(spec ?? {})) out[k] = applyTemplate(v, record);
  return out;
}
