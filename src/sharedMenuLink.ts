import { isSharedMenuId } from './sharedMenuId';

export function sharedMenuIdFromPath(pathname: string, base: string): string | null {
  const prefix = base.endsWith('/') ? base : `${base}/`;
  if (!pathname.startsWith(prefix)) return null;
  const segment = pathname.slice(prefix.length);
  return isSharedMenuId(segment) ? segment : null;
}

export function consumeSharedMenuLink(browser: Pick<Window, 'history' | 'location'>, base: string) {
  browser.history.replaceState(browser.history.state, '', `${base}${browser.location.search}${browser.location.hash}`);
}