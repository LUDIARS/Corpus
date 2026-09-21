import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';

import type { AuthIdentity } from '../auth.ts';
import { CapabilityNotFoundError, type HubRegistry } from '../hub/registry.ts';
import { makeCapabilitiesRouter } from './capabilities.ts';

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
  app.route('/api/capabilities', makeCapabilitiesRouter(registry));
  return app;
}

async function invoke(app: Hono, body: string): Promise<Response> {
  return app.request('/api/capabilities/announcements/list_announcements/invoke', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
  });
}

describe('capability HTTP route', () => {
  it('lists registered capabilities without invoking them', async () => {
    const invokeCapability = vi.fn();
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
      invokeCapability,
    } as unknown as HubRegistry;

    const response = await makeApp(registry).request('/api/capabilities');

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      capabilities: [{ id: 'announcements.list_announcements' }],
    });
    expect(invokeCapability).not.toHaveBeenCalled();
  });

  it('passes the authenticated identity to the shared registry handler', async () => {
    const invokeCapability = vi.fn().mockResolvedValue({ items: [] });
    const registry = { invokeCapability } as unknown as HubRegistry;

    const response = await invoke(makeApp(registry), JSON.stringify({ limit: 3 }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ result: { items: [] } });
    expect(invokeCapability).toHaveBeenCalledWith(
      'announcements',
      'list_announcements',
      { limit: 3 },
      identity,
    );
  });

  it('rejects a malformed or non-object body before reaching the handler', async () => {
    const invokeCapability = vi.fn();
    const registry = { invokeCapability } as unknown as HubRegistry;
    const app = makeApp(registry);

    await expect(invoke(app, 'not json').then((r) => r.status)).resolves.toBe(400);
    await expect(invoke(app, '[1,2]').then((r) => r.status)).resolves.toBe(400);
    expect(invokeCapability).not.toHaveBeenCalled();
  });

  it('distinguishes an unknown capability from a failing handler', async () => {
    const notFound = {
      invokeCapability: vi.fn().mockRejectedValue(
        new CapabilityNotFoundError('announcements', 'list_announcements'),
      ),
    } as unknown as HubRegistry;
    const failing = {
      invokeCapability: vi.fn().mockRejectedValue(new Error('upstream down')),
    } as unknown as HubRegistry;

    const missing = await invoke(makeApp(notFound), '{}');
    expect(missing.status).toBe(404);
    await expect(missing.json()).resolves.toEqual({ error: 'capability_not_found' });

    const failed = await invoke(makeApp(failing), '{}');
    expect(failed.status).toBe(422);
    await expect(failed.json()).resolves.toEqual({
      error: 'capability_failed',
      detail: 'upstream down',
    });
  });
});
