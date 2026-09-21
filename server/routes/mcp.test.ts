import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';

import type { AuthIdentity } from '../auth.ts';
import type { HubRegistry } from '../hub/registry.ts';
import { makeMcpRouter } from './mcp.ts';

const identity: AuthIdentity = {
  userId: 'user-1',
  externalId: 'employee-1',
  role: 'member',
  displayName: 'Test User',
  projectKey: null,
  isAdmin: false,
};

function makeApp(registry: HubRegistry): Hono {
  const app = new Hono();
  app.use('*', async (context, next) => {
    context.set('auth', identity);
    await next();
  });
  app.route('/mcp', makeMcpRouter(registry));
  return app;
}

describe('MCP HTTP route', () => {
  it('lists capabilities as tools', async () => {
    const registry = {
      listCapabilities: () => [{
        id: 'announcements.list_announcements',
        moduleId: 'announcements',
        capabilityId: 'list_announcements',
        title: 'お知らせ一覧',
        description: '一覧を取得',
        inputSchema: { type: 'object' as const, additionalProperties: false },
        readOnly: true,
      }],
    } as HubRegistry;
    const response = await makeApp(registry).request('/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/list',
      }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      result: { tools: [{ name: 'announcements__list_announcements' }] },
    });
  });

  it('returns structured content from the shared handler', async () => {
    const invokeCapability = vi.fn().mockResolvedValue({ items: [{ id: 1 }] });
    const registry = { invokeCapability } as unknown as HubRegistry;
    const response = await makeApp(registry).request('/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: {
          name: 'announcements__list_announcements',
          arguments: {},
        },
      }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      result: {
        structuredContent: { items: [{ id: 1 }] },
      },
    });
  });
});
