import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { installPublicReadRoutes } from './public-read-routes.ts';

describe('anonymous read boundary', () => {
  it('serves reads and prevents mutations before host handlers run', async () => {
    const app = new Hono();
    let calls = 0;
    const routes = new Hono().all('/items', c => { calls++; return c.text('published'); });
    installPublicReadRoutes(app, routes);
    expect(await (await app.request('/public/items')).text()).toBe('published');
    expect((await app.request('/public/items', { method: 'HEAD' })).status).toBe(200);
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
      const response = await app.request('/public/items', { method });
      expect(response.status).toBe(405);
      expect(response.headers.get('Allow')).toBe('GET, HEAD');
    }
    expect(calls).toBe(2);
    expect((await app.request('/public/items')).headers.get('Cache-Control')).toBe('no-store');
  });

  it('keeps API authentication intact and terminates unknown public routes', async () => {
    const app = new Hono();
    installPublicReadRoutes(app, new Hono().get('/api/private', c => c.text('public projection')));
    app.use('/api/*', async c => c.text('unauthenticated', 401));
    app.get('/api/private', c => c.text('secret'));
    app.all('*', c => c.text('fallback'));
    expect((await app.request('/api/private')).status).toBe(401);
    expect((await app.request('/public/missing')).status).toBe(404);
    expect((await app.request('/public')).status).toBe(404);
  });
});
