import { useEffect, useState } from 'react';
import { MargoSays } from '@/components/margo/characters';

/** Chrome on Android offers its own install prompt; we hold on to it until the person taps the button. */
type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };
let saved: InstallEvent | null = null;
const listeners = new Set<() => void>();
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (event) => { event.preventDefault(); saved = event as InstallEvent; listeners.forEach((fn) => fn()); });
  window.addEventListener('appinstalled', () => { saved = null; listeners.forEach((fn) => fn()); });
}

const KEY = 'margo-install-tip-hidden';
const read = () => { try { return localStorage.getItem(KEY) === '1'; } catch { return false; } };
const hide = () => { try { localStorage.setItem(KEY, '1'); } catch { /* private mode */ } };

export function isInstalled() {
  return window.matchMedia?.('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}
const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isPhone = () => isIos() || /android/i.test(navigator.userAgent);

/** Margo suggests adding her to the home screen. `always` shows it in Settings even after it was hidden on Home. */
export function InstallTip({ always = false }: { always?: boolean }) {
  const [, rerender] = useState(0);
  const [hidden, setHidden] = useState(read);
  useEffect(() => { const fn = () => rerender((n) => n + 1); listeners.add(fn); return () => { listeners.delete(fn); }; }, []);
  if (isInstalled()) return always ? <MargoSays size={40}>You're using the home-screen app. Nice.</MargoSays> : null;
  if (!always && (hidden || !isPhone())) return null;
  const close = always ? null : <button type="button" className="m-btn outline" onClick={() => { hide(); setHidden(true); }}>Not now</button>;
  if (saved) {
    const install = async () => { const event = saved; if (!event) return; await event.prompt(); await event.userChoice.catch(() => undefined); saved = null; rerender((n) => n + 1); };
    return <MargoSays size={40}>
      <span><strong>Put me on your home screen.</strong> I'll open like an app, full screen.</span>
      <div className="m-today-actions"><button type="button" className="m-btn navy" onClick={() => void install()}>Add Margo</button>{close}</div>
    </MargoSays>;
  }
  if (isIos()) return <MargoSays size={40}>
    <span><strong>Put me on your home screen.</strong> In Safari, tap the Share button <ShareIcon />, scroll down and tap <b>Add to Home Screen</b>, then <b>Add</b>.</span>
    {close && <div className="m-today-actions">{close}</div>}
  </MargoSays>;
  return <MargoSays size={40}>
    <span><strong>Put me on your home screen.</strong> In Chrome, tap the menu <b>⋮</b>, then <b>Add to Home screen</b> or <b>Install app</b>.</span>
    {close && <div className="m-today-actions">{close}</div>}
  </MargoSays>;
}

function ShareIcon() {
  return <svg className="m-share-icon" width="16" height="18" viewBox="0 0 16 20" role="img" aria-label="Share button" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M8 13V2M4.5 5.5 8 2l3.5 3.5M5 9H3a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1h-2" /></svg>;
}
