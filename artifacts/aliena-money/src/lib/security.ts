/**
 * Security rules for the published app. Replit serves the pages as static files, so the rules are added
 * here, at startup, before sign-in or anything else loads. They allow only what Margo uses: its own server,
 * Clerk sign-in (which lives at clerk.<this domain>), Cloudflare's bot check, Plaid, Google Fonts and
 * product photos from https sites. Scripts injected into the page, plugins and form posts elsewhere are blocked.
 */
export function applySecurityRules() {
  if (!import.meta.env.PROD) return; // Replit's preview tools need a looser setup while developing.
  if (import.meta.env.VITE_CSP === 'off') return; // Emergency off switch: set the VITE_CSP secret to off and republish.
  const sources = new Set<string>([`https://clerk.${window.location.hostname}`]);
  const key = String(import.meta.env.VITE_CLERK_PUBLISHABLE_KEY || '').replace(/^pk_(live|test)_/, '');
  try { const host = atob(key).replace(/\$$/, ''); if (/^[a-z0-9.-]+$/i.test(host)) sources.add(`https://${host}`); } catch { /* no key */ }
  try { const proxy = import.meta.env.VITE_CLERK_PROXY_URL; if (proxy) sources.add(new URL(proxy, window.location.origin).origin); } catch { /* relative or none */ }
  const extra = String(import.meta.env.VITE_CSP_EXTRA || '').trim();
  const clerk = `https://*.clerk.accounts.dev https://*.clerk.com ${[...sources].join(' ')} ${extra}`.trim();
  const policy = [
    "default-src 'self'",
    `script-src 'self' ${clerk} https://challenges.cloudflare.com https://cdn.plaid.com`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' data: https://fonts.gstatic.com",
    "img-src 'self' data: blob: https:",
    `connect-src 'self' ${clerk} https://clerk-telemetry.com https://*.plaid.com`,
    `frame-src 'self' ${clerk} https://*.plaid.com https://challenges.cloudflare.com`,
    "worker-src 'self' blob:",
    "media-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ');
  const meta = document.createElement('meta');
  meta.httpEquiv = 'Content-Security-Policy';
  meta.content = policy;
  document.head.prepend(meta);
  const referrer = document.createElement('meta');
  referrer.name = 'referrer';
  referrer.content = 'strict-origin-when-cross-origin';
  document.head.append(referrer);
}
