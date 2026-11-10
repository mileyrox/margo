import { avatarParts, productArtMarkup } from './art-data';

/** The burgundy wax seal with an italic M. */
export function Seal({ size = 32 }: { size?: number }) {
  const dots = [[90, 50], [84.6, 70], [70, 84.6], [50, 90], [30, 84.6], [15.4, 70], [10, 50], [15.4, 30], [30, 15.4], [50, 10], [70, 15.4], [84.6, 30]];
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 100 100">
    <g fill="#5A0F1A"><circle cx="50" cy="50" r="40" />{dots.map(([cx, cy]) => <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="9" />)}</g>
    <text x="50" y="64" textAnchor="middle" fontFamily="Fraunces, serif" fontStyle="italic" fontSize="42" fontWeight="500" fill="#FBF6E4">M</text>
  </svg>;
}

export type ProductArtKind = 'towels' | 'jug' | 'bottle' | 'box' | 'case';

/** Background-removed product cut-out. Stand-in art until real product photos are available. */
export function ProductArt({ art, band, width = 70, label }: { art: ProductArtKind; band: string; width?: number; label: string }) {
  const markup = (productArtMarkup[art] || productArtMarkup.box).replaceAll('__BAND__', band);
  return <svg role="img" aria-label={label} width={width} height={Math.round(width * 1.2)} viewBox="0 0 100 120" dangerouslySetInnerHTML={{ __html: markup }} />;
}

export type AvatarLook = {
  coin: string; eyes: string; brows: string; mouth: string; hair: string; glasses: string; extra: string; bg: string;
};

export const defaultLook: AvatarLook = { coin: 'gold', eyes: 'dots', brows: 'raised', mouth: 'smile', hair: 'curls', glasses: 'none', extra: 'coffee', bg: '#C9DBEC' };

export type Unlock = { kind: 'saved'; amount: number } | { kind: 'debt' };
export type AvatarOption = { id: string; label: string; unlock?: Unlock };

export const avatarCatalog: Record<keyof AvatarLook, AvatarOption[]> = {
  hair: [{ id: 'none', label: 'None' }, { id: 'long', label: 'Long straight' }, { id: 'bangs', label: 'Bangs' }, { id: 'bun', label: 'Bun' }, { id: 'waves', label: 'Long waves' }, { id: 'short', label: 'Short' }, { id: 'side', label: 'Side part' }, { id: 'spiky', label: 'Spiky' }, { id: 'curls', label: 'Curly' }],
  eyes: [{ id: 'dots', label: 'Dots' }, { id: 'happy', label: 'Happy' }, { id: 'wink', label: 'Wink' }, { id: 'big', label: 'Wide' }, { id: 'sleepy', label: 'Sleepy' }, { id: 'money', label: 'Money eyes', unlock: { kind: 'saved', amount: 250 } }],
  brows: [{ id: 'none', label: 'None' }, { id: 'flat', label: 'Calm' }, { id: 'raised', label: 'Curious' }, { id: 'bold', label: 'Determined' }],
  mouth: [{ id: 'smile', label: 'Smile' }, { id: 'grin', label: 'Grin' }, { id: 'smirk', label: 'Smirk' }, { id: 'oh', label: 'Oh!' }, { id: 'tongue', label: 'Silly' }],
  glasses: [{ id: 'none', label: 'None' }, { id: 'round', label: 'Round' }, { id: 'square', label: 'Square' }, { id: 'shades', label: 'Shades' }],
  extra: [{ id: 'none', label: 'None' }, { id: 'coffee', label: 'Coffee' }, { id: 'sprout', label: 'Sprout' }, { id: 'piggy', label: 'Piggy bank' }, { id: 'beanie', label: 'Beanie' }, { id: 'cap', label: 'Cap' }, { id: 'bag', label: 'Money bag', unlock: { kind: 'saved', amount: 250 } }, { id: 'crown', label: 'Crown', unlock: { kind: 'saved', amount: 500 } }, { id: 'grad', label: 'Debt-free cap', unlock: { kind: 'debt' } }],
  coin: [{ id: 'gold', label: 'Gold' }, { id: 'rose', label: 'Rose gold' }, { id: 'silver', label: 'Silver' }, { id: 'copper', label: 'Copper' }, { id: 'mint', label: 'Mint', unlock: { kind: 'saved', amount: 1000 } }],
  bg: [{ id: '#C9DBEC', label: 'Sky' }, { id: '#FBF6E4', label: 'Cream' }, { id: '#DCDDBF', label: 'Olive' }, { id: '#F3D3CC', label: 'Blush' }, { id: '#E8DFC4', label: 'Sand' }, { id: '#FFFFFF', label: 'White' }],
};

export const unlockText = (unlock: Unlock) => (unlock.kind === 'debt' ? 'Pay off a card' : `Save $${unlock.amount.toLocaleString('en-US')}`);
export const isUnlocked = (unlock: Unlock | undefined, saved: number, debtPaidOff: boolean) =>
  !unlock || (unlock.kind === 'debt' ? debtPaidOff : saved >= unlock.amount);

const tints: Record<string, string> = { gold: '#FFF1C7', rose: '#FBE2D8', silver: '#EEF0F3', copper: '#F6D9C3', mint: '#DDF0DC' };

export function parseLook(value: string | undefined): AvatarLook | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<AvatarLook>;
    // 'bob' was retired; people who picked it get the closest new style.
    if (parsed.hair === 'bob') parsed.hair = 'bangs';
    return { ...defaultLook, ...parsed };
  } catch {
    return null;
  }
}

/** Notion-style black line-art face on a reeded coin. */
export function CoinAvatar({ look, size = 44, label = 'Your avatar' }: { look: AvatarLook; size?: number; label?: string }) {
  const layers = (['hair', 'brows', 'eyes', 'mouth', 'glasses', 'extra'] as const)
    .map((group) => avatarParts[group]?.[look[group]] || '')
    .join('');
  return <svg role="img" aria-label={label} width={size} height={size} viewBox="0 0 120 120">
    <circle cx="60" cy="60" r="60" fill={look.bg} />
    <circle cx="60" cy="66" r="33" fill={tints[look.coin] || tints.gold} stroke="#111111" strokeWidth="3" />
    <circle cx="60" cy="66" r="33" fill="none" stroke="#111111" strokeWidth="5" strokeDasharray="1.2 4.6" strokeOpacity="0.35" />
    <path d="M60 64q-3 6 1 7" fill="none" stroke="#111111" strokeWidth="2.2" strokeLinecap="round" />
    <g dangerouslySetInnerHTML={{ __html: layers }} />
  </svg>;
}
