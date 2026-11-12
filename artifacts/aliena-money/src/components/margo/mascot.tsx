import { MargoArt, useMargoKind } from '@/components/margo/characters';

/** Where Margo appears big (welcome, recap slides, empty screens). Shows the character the person picked. */
export type MascotPose = 'receipt' | 'bags' | 'pin' | 'wave' | 'scan' | 'snooze' | 'cheer';

export function MargoMascot({ className = 'm-mascot', label }: { pose?: MascotPose; className?: string; label?: string }) {
  const kind = useMargoKind();
  return <MargoArt kind={kind} size={160} className={className} label={label ?? 'Margo'} />;
}
