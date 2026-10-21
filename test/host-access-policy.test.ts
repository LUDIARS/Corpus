import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { installHostAccessPolicy } from '../server/host-access-policy.ts';

describe('host access policy', () => {
  it('denies plugin, relay and MCP requests while allowing an explicit status read', async () => {
    const app = new Hono();
    installHostAccessPolicy(app, async (c, next) => {
      if (c.req.method === 'GET' && c.req.path === '/api/hub/connectors') return next();
      return c.json({ error: 'approval_required' }, 403);
    });
    app.all('*', c => c.text('protected result'));
    for (const path of ['/api/x/example/data', '/api/hub/data/private/items', '/api/capabilities', '/mcp', '/mcp/tools']) {
      expect((await app.request(path)).status).toBe(403);
    }
    expect((await app.request('/api/hub/connectors')).status).toBe(200);
    expect((await app.request('/api/hub/connectors', { method: 'POST' })).status).toBe(403);
  });

  it('does not override an earlier authentication denial', async () => {
    const app = new Hono();
    app.use('/api/*', async c => c.text('unauthenticated', 401));
    installHostAccessPolicy(app, async c => c.text('allowed'));
    expect((await app.request('/api/me')).status).toBe(401);
  });
});
