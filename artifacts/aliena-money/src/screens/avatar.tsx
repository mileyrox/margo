import { useEffect, useState } from 'react';
import { useLocation } from 'wouter';
import { useGetFinanceDashboard } from '@workspace/api-client-react';
import { Lock, Shuffle } from 'lucide-react';
import { BackLink } from '@/components/margo/chrome';
import { type AvatarLook, CoinAvatar, avatarCatalog, defaultLook, isUnlocked, parseLook, unlockText } from '@/components/margo/art';
import { useProfileAnswers } from '@/lib/profile';
import { messageOf, money } from '@/lib/format';

const tabs: Array<[keyof AvatarLook, string]> = [['hair', 'Hair'], ['eyes', 'Eyes'], ['brows', 'Brows'], ['mouth', 'Mouth'], ['glasses', 'Glasses'], ['extra', 'Extras'], ['coin', 'Coin'], ['bg', 'Color']];

export function AvatarPage() {
  const [, setLocation] = useLocation();
  const dashboard = useGetFinanceDashboard();
  const { answers, patch, saving, profile } = useProfileAnswers();
  const [look, setLook] = useState<AvatarLook>(defaultLook);
  const [tab, setTab] = useState<keyof AvatarLook>('hair');
  const [hint, setHint] = useState('');
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    if (loaded || profile.isLoading) return;
    setLook(parseLook(answers.avatar) || defaultLook); setLoaded(true);
  }, [answers.avatar, loaded, profile.isLoading]);

  const saved = Number(dashboard.data?.annualSavings || 0);
  const debtPaidOff = answers.hasDebt === 'Yes' && answers.debtBalance !== undefined && answers.debtBalance !== '' && Number(answers.debtBalance) === 0;
  const nextGoal = [250, 500, 1000].find((amount) => saved < amount);
  const pick = (id: string, label: string, unlocked: boolean, lockLabel: string) => {
    if (!unlocked) { setHint(`${label} unlocks when you ${lockLabel.charAt(0).toLowerCase()}${lockLabel.slice(1)}. Keep going!`); return; }
    setHint(''); setLook((current) => ({ ...current, [tab]: id }));
  };
  const shuffle = () => {
    setHint('');
    setLook(Object.fromEntries(tabs.map(([key]) => {
      const free = avatarCatalog[key].filter((option) => isUnlocked(option.unlock, saved, debtPaidOff));
      return [key, free[Math.floor(Math.random() * free.length)].id];
    })) as AvatarLook);
  };
  const save = async () => {
    setError('');
    try { await patch({ avatar: JSON.stringify(look) }); setLocation('/settings'); } catch (reason) { setError(messageOf(reason)); }
  };

  return <div className="m-page">
    <BackLink href="/settings">Settings</BackLink>
    <h1 className="m-h1-sm">Your avatar</h1>
    <div className="m-avatar-stage">
      <CoinAvatar look={look} size={168} />
      <button type="button" className="m-btn outline small" onClick={shuffle}><Shuffle aria-hidden="true" />Surprise me</button>
    </div>
    {nextGoal && <div className="m-card m-stack">
      <div className="m-line"><strong>Next unlock at {money(nextGoal)} saved</strong><span className="m-muted">{money(saved)}</span></div>
      <div className="m-bar"><i className="olive" style={{ width: `${Math.min(100, saved / nextGoal * 100)}%` }} /></div>
    </div>}
    <div className="m-tabs" role="tablist" aria-label="Avatar parts">
      {tabs.map(([key, label]) => <button key={key} role="tab" aria-selected={tab === key} className={`m-chip ${tab === key ? 'on' : ''}`} onClick={() => { setTab(key); setHint(''); }}>{label}</button>)}
    </div>
    <div className="m-avatar-grid" role="tabpanel">
      {avatarCatalog[tab].map((option) => {
        const unlocked = isUnlocked(option.unlock, saved, debtPaidOff);
        const lockLabel = option.unlock ? unlockText(option.unlock) : '';
        const selected = look[tab] === option.id;
        return <button type="button" key={option.id} className={`m-avatar-option ${selected ? 'on' : ''} ${unlocked ? '' : 'locked'}`} aria-pressed={selected} aria-label={`${option.label}${unlocked ? '' : `, locked: ${lockLabel}`}`} onClick={() => pick(option.id, option.label, unlocked, lockLabel)}>
          <CoinAvatar look={{ ...look, [tab]: option.id }} size={64} label="" />
          <span>{option.label}</span>
          {!unlocked && <small><Lock aria-hidden="true" />{lockLabel}</small>}
        </button>;
      })}
    </div>
    {hint && <div className="m-card m-notice" role="status">{hint}</div>}
    {error && <div className="m-error" role="alert">{error}</div>}
    <button className="m-btn navy" disabled={saving} onClick={() => void save()}>{saving ? 'Saving…' : 'Save my avatar'}</button>
  </div>;
}
