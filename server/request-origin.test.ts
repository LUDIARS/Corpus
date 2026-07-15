import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { resolveRequestOrigin } from './request-origin.ts';

function appWithOriginRoute(): Hono {
  const app = new Hono();
  app.get('/', (c) => c.text(resolveRequestOrigin(c)));
  return app;
}

describe('resolveRequestOrigin', () => {
  it('uses the request origin without a forwarding header', async () => {
    const response = await appWithOriginRoute().request('http://glab.test:5187/');
    expect(await response.text()).toBe('http://glab.test:5187');
  });

  it('restores HTTPS terminated by a reverse proxy', async () => {
    const response = await appWithOriginRoute().request('http://glab.example/', {
      headers: { 'x-forwarded-proto': 'https' },
    });
    expect(await response.text()).toBe('https://glab.example');
  });

  it('uses the first value in a forwarding chain', async () => {
    const response = await appWithOriginRoute().request('http://glab.example/', {
      headers: { 'x-forwarded-proto': 'https, http' },
    });
    expect(await response.text()).toBe('https://glab.example');
  });

  it('ignores unsupported forwarded protocols', async () => {
    const response = await appWithOriginRoute().request('http://glab.example/', {
      headers: { 'x-forwarded-proto': 'javascript' },
    });
    expect(await response.text()).toBe('http://glab.example');
  });
});
