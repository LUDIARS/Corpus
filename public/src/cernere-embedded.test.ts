// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { act } from 'react';
import { mountCernereLogin } from './cernere-login.tsx';

let dispose: (() => void) | undefined;
afterEach(async () => { await act(() => dispose?.()); document.body.innerHTML = ''; vi.unstubAllGlobals(); });

it('mounts the current hosted card in both configured modes without opening another window', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const open = vi.fn(); vi.stubGlobal('open', open);
  for (const authUiMode of ['passkey', 'composite']) {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ authUiMode, cernereFrontendUrl: 'https://cr.example' })));
    const root = document.createElement('div'); document.body.append(root);
    await act(async () => { dispose = mountCernereLogin(root, 'Log in'); });
    const frame = root.querySelector('iframe')!;
    expect(new URL(frame.src).pathname).toBe('/composite/login');
    expect(new URL(frame.src).searchParams.get('origin')).toBe(window.location.origin);
    expect(root.querySelector('input[type=password]')).toBeNull();
    expect(open).not.toHaveBeenCalled();
    await act(() => dispose?.()); dispose = undefined; root.remove();
  }
});
