import { API_BASE_URL } from '@/api/client';

/**
 * The board is served by the backend, not by this portal, so the URL is built from the same
 * `API_BASE_URL` the API client uses (host of the page, port of the backend) rather than from
 * `window.location.origin` — the admin UI and the backend run on different ports in dev, and
 * `window.location.origin` would point an iframe or a copied link straight at the admin app.
 */
export function menuBoardUrl(code: string): string {
  const origin = API_BASE_URL.replace(/\/api\/v1\/?$/, '');
  return `${origin}/menu-board?screen=${encodeURIComponent(code)}`;
}
