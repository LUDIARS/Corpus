import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';

import type { CorpusDb } from '../db.ts';
import type { DiscoveryController } from '../hub/discovery.ts';
import type { CorpusServiceManifest } from '../hub/manifest.ts';
import type { HubRegistry } from '../hub/registry.ts';
import type { TokenProvider } from '../hub/tokens.ts';
import type { ServiceConnector } from '../hub/types.ts';
import { makeHubRouter } from './hub.ts';

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
    data: [{ id: 'items', path: '/items', scope: 'multi' }],
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
  } as unknown as HubRegistry;
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('userToken', 'user-token');
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
    getDownstreamToken: vi.fn().mockResolvedValue(token),
  };
}

describe('hub downstream authentication', () => {
  it('project-token を発行できなければ匿名リクエストへ劣化しない', async () => {
    const fetchImpl = vi.fn<ServiceConnector['fetch']>();
    const tokenProvider = makeTokenProvider(null);
    const app = makeApp(
      makeConnector('cernere-project-token', fetchImpl),
      tokenProvider,
    );

    const response = await app.request(
      'http://localhost/api/hub/data/service/items',
    );

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({
      error: 'downstream_token_unavailable',
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
    expect(tokenProvider.getDownstreamToken).not.toHaveBeenCalled();
    const init = fetchImpl.mock.calls[0]?.[1];
    expect(new Headers(init?.headers).has('authorization')).toBe(false);
  });

  it('発行した project-token だけを認証必須サービスへ送る', async () => {
    const fetchImpl = vi
      .fn<ServiceConnector['fetch']>()
      .mockResolvedValue(Response.json({ ok: true }));
    const tokenProvider = makeTokenProvider('project-token');
    const app = makeApp(
      makeConnector('cernere-project-token', fetchImpl),
      tokenProvider,
    );

    const response = await app.request(
      'http://localhost/api/hub/data/service/items',
    );

    expect(response.status).toBe(200);
    expect(tokenProvider.getDownstreamToken).toHaveBeenCalledWith('user-token', {
      service: 'service',
      projectKey: 'service-project',
      baseUrl: 'http://service.test',
    });
    const init = fetchImpl.mock.calls[0]?.[1];
    expect(new Headers(init?.headers).get('authorization')).toBe(
      'Bearer project-token',
    );
  });

  it('未知の認証方式を fail closed にする', async () => {
    const fetchImpl = vi.fn<ServiceConnector['fetch']>();
    const tokenProvider = makeTokenProvider('must-not-be-forwarded');
    const app = makeApp(makeConnector('api-key', fetchImpl), tokenProvider);

    const response = await app.request(
      'http://localhost/api/hub/data/service/items',
    );

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({
      error: 'unsupported_downstream_auth',
    });
    expect(tokenProvider.getDownstreamToken).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
