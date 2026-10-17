import { installBrowserResumeReload } from './browser-resume.ts';

/** Owns resume recovery for a mounted authenticated hub shell. */
export function installHubResumeRecovery(
  root: HTMLElement,
  isConnectionStale: () => boolean,
  reload: () => void = () => window.location.reload(),
): () => void {
  const edited = new Set<Element>();
  let notice: HTMLElement | null = null;
  const onEdit = (event: Event): void => {
    if (event.target instanceof Element) edited.add(event.target);
  };
  const onReset = (event: Event): void => {
    if (!(event.target instanceof Element)) return;
    for (const element of edited) if (event.target.contains(element)) edited.delete(element);
  };
  const hasPendingWork = (): boolean => {
    for (const element of edited) if (!root.contains(element)) edited.delete(element);
    return edited.size > 0 || root.querySelector('button:disabled, [aria-busy="true"]') !== null;
  };
  const showNotice = (): void => {
    if (notice) return;
    notice = document.createElement('aside');
    notice.setAttribute('role', 'status');
    notice.textContent = '接続の更新が必要です。入力内容を保存してから画面を更新してください。 ';
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = '画面を更新';
    button.onclick = () => {
      if (!navigator.onLine || root.querySelector('button:disabled, [aria-busy="true"]')) return;
      if (hasPendingWork() && !window.confirm('未保存の入力は失われます。画面を更新しますか？')) return;
      reload();
    };
    notice.append(button);
    root.prepend(notice);
  };
  root.addEventListener('input', onEdit);
  root.addEventListener('change', onEdit);
  root.addEventListener('reset', onReset);
  const stop = installBrowserResumeReload({
    window, document, isConnectionStale, reload,
    canReload: () => {
      if (!hasPendingWork()) return true;
      showNotice();
      return false;
    },
  });
  return () => {
    stop();
    root.removeEventListener('input', onEdit);
    root.removeEventListener('change', onEdit);
    root.removeEventListener('reset', onReset);
    notice?.remove();
    edited.clear();
  };
}
