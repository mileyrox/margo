import { CoinAvatar, type AvatarLook } from '@/components/margo/art';

/** Margo the mascot: a coin with bangs, glasses and eyelashes, in a navy blazer, acting things out. */
const labels: Record<string, string> = {
  receipt: 'Margo reading a long receipt', bags: 'Margo carrying shopping bags', pin: 'Margo pointing at a map pin',
  wave: 'Margo waving hello', scan: 'Margo scanning a barcode', snooze: 'Margo napping', cheer: 'Margo celebrating',
};

const margoLook: AvatarLook = { coin: 'gold', eyes: 'dots', brows: 'none', mouth: 'smile', hair: 'bangs', glasses: 'round', extra: 'none', bg: 'transparent' };
const INK = '#111111', SKIN = '#FFF1C7';
/** An arm or leg: a dark outline with a lighter line inside, like the coin's edge. */
const Limb = ({ d }: { d: string }) => <><path d={d} fill="none" stroke={INK} strokeWidth="10" strokeLinecap="round" /><path d={d} fill="none" stroke={SKIN} strokeWidth="5" strokeLinecap="round" /></>;
const Hand = ({ x, y }: { x: number; y: number }) => <circle cx={x} cy={y} r="8" fill={SKIN} stroke={INK} strokeWidth="2.6" />;

/** Margo the mascot (a coin with bangs, glasses and eyelashes, on a little body), acting out each slide. */
export type MascotPose = 'receipt' | 'bags' | 'pin' | 'wave' | 'scan' | 'snooze' | 'cheer';

export function MargoMascot({ pose, className = 'm-mascot', label }: { pose: MascotPose; className?: string; label?: string }) {
  return <svg className={className} viewBox="0 0 240 262" role="img" aria-label={label ?? labels[pose]}>
    <Limb d="M108 200L106 240" /><Limb d="M132 200L134 240" />
    <ellipse cx="101" cy="246" rx="13" ry="7" fill="#5A0F1A" stroke={INK} strokeWidth="2.4" /><ellipse cx="139" cy="246" rx="13" ry="7" fill="#5A0F1A" stroke={INK} strokeWidth="2.4" />
    {/* Navy blazer with a white collar, gold buttons and a burgundy skirt */}
    <path d="M94 122Q120 112 146 122L152 190H88Z" fill="#0B1F4B" stroke={INK} strokeWidth="3" strokeLinejoin="round" />
    <path d="M108 118L120 142L132 118" fill="#FFFFFF" stroke={INK} strokeWidth="3" strokeLinejoin="round" />
    <path d="M88 190h64l4 12H84z" fill="#5A0F1A" stroke={INK} strokeWidth="3" strokeLinejoin="round" />
    <circle cx="120" cy="158" r="2.6" fill="#E8C56B" /><circle cx="120" cy="172" r="2.6" fill="#E8C56B" />
    {pose === 'receipt' && <>
      <Limb d="M94 136Q72 150 84 170" /><Hand x={86} y={171} />
      <path d="M170 34h46v96l-7.6-6-7.7 6-7.7-6-7.7 6-7.7-6-7.6 6z" fill="#FFFFFF" stroke={INK} strokeWidth="3" strokeLinejoin="round" />
      <path d="M179 50h28M179 62h28M179 74h18M179 92h28" stroke={INK} strokeWidth="2.6" strokeLinecap="round" /><path d="M179 106h28" stroke="#5A0F1A" strokeWidth="4" strokeLinecap="round" />
      <Limb d="M146 136Q166 138 174 118" /><Hand x={175} y={116} />
    </>}
    {pose === 'bags' && <>
      <Limb d="M94 136Q76 156 70 180" /><Limb d="M146 136Q164 156 170 180" />
      <path d="M48 190h44l-4 46H52z" fill="#FFFFFF" stroke={INK} strokeWidth="3" strokeLinejoin="round" /><path d="M60 190q10-18 20 0" fill="none" stroke={INK} strokeWidth="3" />
      <path d="M148 190h44l-4 46h-36z" fill="#F2C9CE" stroke={INK} strokeWidth="3" strokeLinejoin="round" /><path d="M160 190q10-18 20 0" fill="none" stroke={INK} strokeWidth="3" />
      <Hand x={70} y={182} /><Hand x={170} y={182} />
    </>}
    {pose === 'pin' && <>
      <Limb d="M94 136Q78 156 82 176" /><Hand x={82} y={178} />
      <path d="M204 22c-15 0-26 11-26 25 0 19 26 43 26 43s26-24 26-43c0-14-11-25-26-25z" fill="#FFFFFF" stroke={INK} strokeWidth="3" strokeLinejoin="round" /><circle cx="204" cy="47" r="9" fill="#5A0F1A" />
      <Limb d="M146 134Q170 130 184 108" /><Hand x={186} y={105} /><Limb d="M190 100L198 92" />
    </>}
    {pose === 'wave' && <>
      <Limb d="M94 136Q78 156 82 176" /><Hand x={82} y={178} />
      <Limb d="M146 134Q172 126 180 96" /><Hand x={181} y={92} />
      <path d="M196 78q6 4 6 12M200 68q10 6 10 20" fill="none" stroke={INK} strokeWidth="2.6" strokeLinecap="round" />
    </>}
    {pose === 'scan' && <>
      <Limb d="M94 136Q74 150 66 162" />
      <rect x="40" y="156" width="36" height="44" rx="4" fill="#FFFFFF" stroke={INK} strokeWidth="3" />
      <path d="M48 168v20M54 168v20M58 168v20M64 168v20M69 168v20" stroke={INK} strokeWidth="2.4" />
      <Hand x={68} y={164} />
      <Limb d="M146 136Q168 132 178 116" />
      <rect x="172" y="62" width="34" height="58" rx="6" fill="#FFFFFF" stroke={INK} strokeWidth="3" />
      <path d="M180 86h18" stroke="#5A0F1A" strokeWidth="3" strokeLinecap="round" />
      <Hand x={180} y={118} />
    </>}
    {pose === 'snooze' && <>
      <Limb d="M94 136Q78 156 82 176" /><Hand x={82} y={178} />
      <Limb d="M146 136Q162 156 158 176" /><Hand x={158} y={178} />
      <text x="178" y="52" fontFamily="Georgia, serif" fontSize="26" fontWeight="600" fill="#FFFFFF" stroke={INK} strokeWidth="1">z</text>
      <text x="196" y="34" fontFamily="Georgia, serif" fontSize="18" fontWeight="600" fill="#FFFFFF" stroke={INK} strokeWidth="0.8">z</text>
    </>}
    {pose === 'cheer' && <>
      <Limb d="M94 134Q68 124 62 96" /><Hand x={61} y={92} />
      <Limb d="M146 134Q172 124 178 96" /><Hand x={179} y={92} />
      {[[30, 60, '#F2C9CE', 20], [44, 28, '#FFFFFF', 40], [200, 30, '#F2C9CE', 60], [214, 66, '#FFFFFF', 10], [24, 110, '#E8C56B', 30], [218, 112, '#E8C56B', 50]].map(([x, y, c, r]) => <rect key={`${x}-${y}`} x={x as number} y={y as number} width="7" height="7" fill={c as string} transform={`rotate(${r} ${x} ${y})`} />)}
    </>}
    <g transform="translate(50 -6)">
      <CoinAvatar look={margoLook} size={140} label="" />
      <svg width="140" height="140" viewBox="0 0 120 120" aria-hidden="true"><path d="M45 60.5l-3.2-3.4M48 58.6l-1.2-4.2M52 58.6l.8-4.2M75 60.5l3.2-3.4M72 58.6l1.2-4.2M68 58.6l-.8-4.2" fill="none" stroke={INK} strokeWidth="1.9" strokeLinecap="round" /></svg>
    </g>
  </svg>;
}

