import { MargoFull } from '@/components/margo/characters';

/** Where Margo appears big (welcome, empty screens): the flat-mark Margo, full body, waving. */
export type MascotPose = 'receipt' | 'bags' | 'pin' | 'wave' | 'scan' | 'snooze' | 'cheer';

export function MargoMascot({ className = 'm-mascot', label }: { pose?: MascotPose; className?: string; label?: string }) {
  return <MargoFull size={160} className={className} label={label ?? 'Margo'} />;
}
