// /api/me — 自分の identity。 requireAuth 配下で mount される。

import { Hono } from 'hono';
import { getIdentity } from '../auth.ts';
import { cacheDisplayName, type CorpusDb } from '../db.ts';

export function makeMeRouter(db: CorpusDb): Hono {
  const r = new Hono();
  r.get('/', (c) => {
    const id = getIdentity(c);
    // 表示名を availability cache に流す (Cernere が source of truth)
    if (id.displayName) cacheDisplayName(db, id.userId, id.displayName);
    return c.json({
      userId: id.userId,
      externalId: id.externalId,
      role: id.role,
      displayName: id.displayName,
      isAdmin: id.isAdmin,
    });
  });
  return r;
}
