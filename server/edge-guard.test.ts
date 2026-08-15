import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { checkEdgeDevIdentity, makeEdgeHeaderGuard, parseAuthMode } from './edge-guard.ts';

function appWithGuard(devBypass = false): Hono {
  const app = new Hono();
  app.use('*', makeEdgeHeaderGuard({ devBypass }));
  app.get('/api/health', (c) => c.json({ ok: true }));
  app.get('/api/thing', (c) => c.json({ ok: true }));
  return app;
}

describe('parseAuthMode', () => {
  it('requires an explicit mode', () => {
    expect(parseAuthMode(undefined)).toBeNull();
    expect(parseAuthMode('   ')).toBeNull();
  });

  it('accepts the two known modes', () => {
    expect(parseAuthMode('composite')).toBe('composite');
    expect(parseAuthMode(' edge ')).toBe('edge');
  });

  it('rejects an unknown mode instead of silently defaulting', () => {
    // 設定ミスを既定値で吸収すると、 edge のつもりが composite で動く。
    expect(parseAuthMode('Edge')).toBeNull();
    expect(parseAuthMode('cloudflare')).toBeNull();
  });
});

describe('edge header guard', () => {
  it('rejects a request without the assertion header', async () => {
    const res = await appWithGuard().request('/api/thing');
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: 'edge_assertion_missing' });
  });

  it('rejects a blank assertion header', async () => {
    const res = await appWithGuard().request('/api/thing', {
      headers: { 'cf-access-jwt-assertion': '   ' },
    });
    expect(res.status).toBe(401);
  });

  it('passes a request carrying the header through untouched', async () => {
    // 値の中身は検証しない。 署名検証は Cernere の責務で、 ここは構成事故の検知だけ。
    const res = await appWithGuard().request('/api/thing', {
      headers: { 'cf-access-jwt-assertion': 'not-a-real-jwt' },
    });
    expect(res.status).toBe(200);
  });

  it('keeps health reachable so a loopback probe does not read as down', async () => {
    // Excubitor は Cloudflare を経由せず loopback から直接叩く。
    const res = await appWithGuard().request('/api/health');
    expect(res.status).toBe(200);
  });

  it('skips the check entirely under the dev bypass', async () => {
    const res = await appWithGuard(true).request('/api/thing');
    expect(res.status).toBe(200);
  });
});

describe('checkEdgeDevIdentity', () => {
  const local = 'http://localhost:5185';

  it('is inert when the variable is unset', () => {
    expect(checkEdgeDevIdentity({ value: undefined, nodeEnv: 'development', publicUrl: local }))
      .toEqual({ allowed: false });
  });

  it('allows it on a loopback public URL outside production', () => {
    expect(
      checkEdgeDevIdentity({ value: 'dev@example.com', nodeEnv: 'development', publicUrl: local })
        .allowed,
    ).toBe(true);
  });

  it('refuses it in production', () => {
    const check = checkEdgeDevIdentity({
      value: 'dev@example.com',
      nodeEnv: 'production',
      publicUrl: local,
    });
    expect(check.allowed).toBe(false);
    expect(check.reason).toContain('NODE_ENV=production');
  });

  it('refuses it when the public URL is not loopback', () => {
    // 開発用バイパスを本番設定へ置き忘れる事故が、 このガードの主対象。
    const check = checkEdgeDevIdentity({
      value: 'dev@example.com',
      nodeEnv: 'development',
      publicUrl: 'https://hub.example.com',
    });
    expect(check.allowed).toBe(false);
    expect(check.reason).toContain('loopback');
  });

  it('refuses it when the public URL cannot be parsed', () => {
    const check = checkEdgeDevIdentity({
      value: 'dev@example.com',
      nodeEnv: 'development',
      publicUrl: 'not a url',
    });
    expect(check.allowed).toBe(false);
  });
});
