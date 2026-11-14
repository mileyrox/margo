import { Seal } from '@/components/margo/art';

/** The Margo logo on the blush page, shown while the app loads (matches the one built into index.html). */
export function Splash() {
  return <div className="m-splash" role="status" aria-label="Loading Margo"><Seal size={76} /><span>Margo</span></div>;
}
