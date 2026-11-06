// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { act } from 'react';
import { webcrypto } from 'node:crypto';
import { mountCernereLogin } from './cernere-login.tsx';

let dispose: (() => void) | undefined;
afterEach(async () => { await act(() => dispose?.()); document.body.innerHTML = ''; vi.unstubAllGlobals(); });

it('mounts the current hosted card in both configured modes without opening another window', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  // Use the platform SHA-256 implementation rather than a mocked PKCE result.
  vi.stubGlobal('crypto', webcrypto);
  const open = vi.fn(); vi.stubGlobal('open', open);
  for (const authUiMode of ['passkey', 'composite']) {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ authUiMode, cernereFrontendUrl: 'https://cr.example', cernereClientId: 'corpus-client' })));
    const root = document.createElement('div'); document.body.append(root);
    await act(async () => { dispose = mountCernereLogin(root, 'Log in'); });
    await vi.waitFor(async () => { await act(async () => {}); expect(root.querySelector('iframe')).not.toBeNull(); });
    const frame = root.querySelector('iframe')!;
    expect(new URL(frame.src).pathname).toBe('/composite/login');
    expect(new URL(frame.src).searchParams.get('origin')).toBe(window.location.origin);
    const parameters = new URL(frame.src).searchParams;
    expect(parameters.get('client_id')).toBe('corpus-client');
    expect(parameters.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(parameters.get('state')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(parameters.has('code_verifier')).toBe(false);
    expect(root.querySelector('input[type=password]')).toBeNull();
    expect(open).not.toHaveBeenCalled();
    await act(() => dispose?.()); dispose = undefined; root.remove();
  }
});

it('refuses to mount a code-only frame when the service client registration is missing', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ cernereFrontendUrl: 'https://cr.example' })));
  const root = document.createElement('div'); document.body.append(root);
  await act(async () => { dispose = mountCernereLogin(root, 'Log in'); });
  expect(root.querySelector('iframe')).toBeNull(); expect(root.querySelector('.error')).not.toBeNull();
});
