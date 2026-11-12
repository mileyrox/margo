import { createRoot } from 'react-dom/client';

import App from './App';
import { ErrorBoundary } from '@/components/error-boundary';

import './index.css';
import { applySecurityRules } from '@/lib/security';

// Don't let other websites show the published app inside a frame (a trick for stealing taps).
// Replit's own preview and local development still work.
const framed = (() => { try { return window.top !== window.self; } catch { return true; } })();
const previewHost = /(\.replit\.dev|\.repl\.co|localhost|127\.0\.0\.1)$/.test(window.location.hostname);
if (framed && !previewHost) {
  try { window.top!.location.href = window.location.href; } catch { document.body.innerHTML = ''; }
  throw new Error('Margo cannot be shown inside another site.');
}
applySecurityRules();

// Home-screen app support: register the service worker on the published app only.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL }).catch(() => undefined);
  });
}

createRoot(document.getElementById('root')!, {
  // Keeps caught errors off reportError(), which would raise the dev overlay.
  onCaughtError: (error, errorInfo) => {
    console.error(error, errorInfo.componentStack);
  },
}).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>,
);
