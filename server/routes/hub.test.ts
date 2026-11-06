import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';

import type { CorpusDb } from '../db.ts';
import type { DiscoveryController } from '../hub/discovery.ts';
import type { CorpusServiceManifest } from '../hub/manifest.ts';
import type { HubRegistry } from '../hub/registry.ts';
import type { TokenProvider } from '../hub/tokens.ts';
import type { ServiceConnector } from '../hub/types.ts';
import { makeHubRouter } from './hub.ts';
import type { ServiceUserSession } from '../auth.ts';
const userSession: ServiceUserSession = { token: 's'.repeat(43), grant: { projectToken: 'private-source', sessionBinding: 'b'.repeat(43), projectKey: 'glab', user: {id:'subject',role:'member',displayName:'User',email:null}, expiresAt:new Date(Date.now()+600000).toISOString() } };

function makeConnector(
  auth: string,
  fetchImpl: ServiceConnector['fetch'],
): ServiceConnector {
  const manifest: CorpusServiceManifest = {
    service: 'service',
    displayName: 'Service',
    version: '1.0.0',
    corpusApi: 1,
    health: '/api/health',
    data: [{ id: 'items', path: '/items', scope: 'multi', delegation: { GET: { action: 'items.read' } } }],
    panels: [],
    auth,
    cernereProjectKey: 'service-project',
  };
  return {
    id: 'service',
    title: 'Service',
    scope: 'multi',
    baseUrl: 'http://service.test',
    health: async () => ({ status: 'up' }),
    fetch: fetchImpl,
    getManifest: () => manifest,
  };
}

function makeApp(
  connector: ServiceConnector,
  tokenProvider: TokenProvider,
): Hono {
  const registry = {
    getConnector: (id: string) => (id === connector.id ? connector : undefined),
    listConnectors: () => [connector],
  } as unknown as HubRegistry;
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('serviceUserSession', userSession);
    await next();
  });
  app.route(
    '/api/hub',
    makeHubRouter({
      registry,
      db: {} as CorpusDb,
      tokenProvider,
      discoveryController: {} as DiscoveryController,
    }),
  );
  return app;
}

function makeTokenProvider(token: string | null): TokenProvider {
  return {
    mode: 'test',
    authorize: vi.fn(async (_session, _target, request) => token ? { path: request.path, init: { ...request.init, headers: { authorization: 'Cernere-Delegation '+token } } } : null),
  };
}

describe('hub downstream authentication', () => {
  it('操作委譲を発行できなければ匿名リクエストへ劣化しない', async () => {
    const fetchImpl = vi.fn<ServiceConnector['fetch']>();
    const tokenProvider = makeTokenProvider(null);
    const app = makeApp(
      makeConnector('cernere-delegated-operation', fetchImpl),
      tokenProvider,
    );

    const response = await app.request(
      'http://localhost/api/hub/data/service/items',
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: 'downstream_authorization_unavailable',
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('auth none のサービスへ利用者 token を送らない', async () => {
    const fetchImpl = vi
      .fn<ServiceConnector['fetch']>()
      .mockResolvedValue(Response.json({ ok: true }));
    const tokenProvider = makeTokenProvider('must-not-be-forwarded');
    const app = makeApp(makeConnector('none', fetchImpl), tokenProvider);

    const response = await app.request(
      'http://localhost/api/hub/data/service/items',
    );

    expect(response.status).toBe(200);
    expect(tokenProvider.authorize).not.toHaveBeenCalled();
    const init = fetchImpl.mock.calls[0]?.[1];
    expect(new Headers(init?.headers).has('authorization')).toBe(false);
  });

  it('対象操作に束縛された一度限りの委譲だけを認証必須サービスへ送る', async () => {
    const fetchImpl = vi
      .fn<ServiceConnector['fetch']>()
      .mockResolvedValue(Response.json({ ok: true }));
    const tokenProvider = makeTokenProvider('operation-capability');
    const app = makeApp(
      makeConnector('cernere-delegated-operation', fetchImpl),
      tokenProvider,
    );

    const response = await app.request(
      'http://localhost/api/hub/data/service/items',
    );

    expect(response.status).toBe(200);
    expect(tokenProvider.authorize).toHaveBeenCalledWith(userSession, {
      service: 'service',
      projectKey: 'service-project',
      baseUrl: 'http://service.test',
    }, { action: 'items.read', path: '/items', init: { method: 'GET', headers: {}, redirect: 'error' }, additionalHeaders: undefined });
    const init = fetchImpl.mock.calls[0]?.[1];
    expect(new Headers(init?.headers).get('authorization')).toBe(
      'Cernere-Delegation operation-capability',
    );
  });

  it('未知の認証方式を fail closed にする', async () => {
    const fetchImpl = vi.fn<ServiceConnector['fetch']>();
    const tokenProvider = makeTokenProvider('must-not-be-forwarded');
    const app = makeApp(makeConnector('api-key', fetchImpl), tokenProvider);

    const response = await app.request(
      'http://localhost/api/hub/data/service/items',
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: 'unsupported_downstream_auth',
    });
    expect(tokenProvider.authorize).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('hub service manifests', () => {
  it('expands refs in inline declarative panels before returning services', async () => {
    const fetchImpl = vi
      .fn<ServiceConnector['fetch']>()
      .mockResolvedValue(Response.json({
        title: 'Shared settings',
        components: [{ type: 'text', value: 'shared body' }],
      }));
    const connector = makeConnector('none', fetchImpl);
    const manifest = connector.getManifest?.();
    if (!manifest) throw new Error('manifest is required');
    manifest.sharedUi = [{ key: 'shared-settings', endpoint: '/shared-settings' }];
    manifest.panels = [{
      id: 'inline',
      kind: 'declarative',
      title: 'Inline',
      ui: {
        descriptorVersion: 1,
        title: 'Inline',
        sections: [{ components: [{ type: 'ref', key: 'shared-settings' }] }],
      },
    }];
    const app = makeApp(connector, makeTokenProvider(null));

    const response = await app.request('http://localhost/api/hub/services');

    expect(response.status).toBe(200);
    const body = await response.json() as {
      services: Array<{ manifest: { panels: Array<{ ui: unknown }> } }>;
    };
    expect(body.services[0]?.manifest.panels[0]?.ui).toMatchObject({
      sections: [{
        components: [{
          type: 'section',
          title: 'Shared settings',
          components: [{ type: 'text', value: 'shared body' }],
        }],
      }],
    });
    expect(fetchImpl).toHaveBeenCalledWith('/shared-settings');
  });
});
