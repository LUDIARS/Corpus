import { Hono } from 'hono';

/** Mount host-owned anonymous reads without weakening authenticated API routes.
 * @implements SPEC-PUBLIC-READ-ROUTES-001
 */
export function installPublicReadRoutes(app: Hono, routes?: Hono): void {
  if (!routes) return;
  const boundary = new Hono();
  boundary.use('*', async (c, next) => {
    c.header('Cache-Control', 'no-store');
    if (c.req.method !== 'GET' && c.req.method !== 'HEAD') {
      c.header('Allow', 'GET, HEAD');
      return c.json({ error: 'read_only' }, 405);
    }
    await next();
  });
  boundary.route('/', routes);
  boundary.all('*', c => c.json({ error: 'not_found' }, 404));
  app.route('/public', boundary);
}
