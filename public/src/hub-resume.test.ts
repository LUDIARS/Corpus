// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installHubResumeRecovery } from './hub-resume.ts';

let dispose: (() => void) | undefined;
afterEach(() => { dispose?.(); document.body.innerHTML = ''; vi.restoreAllMocks(); });

function setup() {
  document.body.innerHTML = '<main><form><input><button>Save</button></form></main>';
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
  const root = document.querySelector('main')!;
  const reload = vi.fn();
  dispose = installHubResumeRecovery(root, () => false, reload);
  return { root, reload, resume: () => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })) };
}

describe('authenticated hub resume', () => {
  it('reloads a clean restored shell once and removes listeners on disposal', () => {
    const h = setup(); h.resume(); h.resume(); expect(h.reload).toHaveBeenCalledTimes(1);
    dispose?.(); h.resume(); expect(h.reload).toHaveBeenCalledTimes(1);
  });
  it('retains edited input and asks before explicit discard', () => {
    const h = setup(); const input = h.root.querySelector('input')!;
    input.value = 'draft'; input.dispatchEvent(new Event('input', { bubbles: true })); h.resume();
    expect(h.reload).not.toHaveBeenCalled(); expect(input.value).toBe('draft');
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    h.root.querySelector('aside button')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(confirm).toHaveBeenCalled(); expect(h.reload).not.toHaveBeenCalled();
    confirm.mockReturnValue(true); h.root.querySelector('aside button')!.dispatchEvent(new MouseEvent('click'));
    expect(h.reload).toHaveBeenCalledTimes(1);
  });
  it('does not interrupt an in-flight submission', () => {
    const h = setup(); h.root.querySelector('form button')!.setAttribute('disabled', ''); h.resume();
    h.root.querySelector('aside button')!.dispatchEvent(new MouseEvent('click'));
    expect(h.reload).not.toHaveBeenCalled();
  });
  it('allows recovery after a saved form reset', () => {
    const h = setup(); h.root.querySelector('input')!.dispatchEvent(new Event('input', { bubbles: true }));
    h.root.querySelector('form')!.reset(); h.resume(); expect(h.reload).toHaveBeenCalledTimes(1);
  });
});
