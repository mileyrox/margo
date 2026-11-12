import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getGetSwapProfileQueryKey, useUpdateSwapProfile } from '@workspace/api-client-react';
import type { SwapProfile } from '@workspace/api-client-react';
import { MargoFace } from '@/components/margo/characters';
import { messageOf } from '@/lib/format';

/** Bump this when the agreement text changes, so everyone is asked again. */
export const AGREEMENT_VERSION = '2026-11';

/** Shown once after sign-up, before anything else: the plain-words basics people agree to. */
export function AgreementPage({ profile }: { profile: SwapProfile }) {
  const qc = useQueryClient();
  const save = useUpdateSwapProfile();
  const [checked, setChecked] = useState(false);
  const [error, setError] = useState('');
  const agree = async () => {
    setError('');
    try {
      await save.mutateAsync({ data: { ...profile, onboardingAnswers: { ...(profile.onboardingAnswers || {}), agreedAt: new Date().toISOString(), agreedVersion: AGREEMENT_VERSION } } });
      await qc.invalidateQueries({ queryKey: getGetSwapProfileQueryKey() });
    } catch (reason) { setError(messageOf(reason)); }
  };
  return <main className="m-page m-stack m-agree">
    <div className="m-agree-head"><MargoFace size={56} label="" /><h1>Before you start</h1><p>Margo is new and still being tested. Here is what you are agreeing to, in plain words.</p></div>
    <ul className="m-card m-agree-list">
      <li><strong>Margo is in early testing.</strong> Things may break or change, and numbers like budgets, tax set-asides and savings are estimates.</li>
      <li><strong>It is not financial, tax or legal advice.</strong> Margo gives general information and suggestions. You make your own money decisions.</li>
      <li><strong>Your bank connects through Plaid.</strong> You sign in inside Plaid's window. Margo can see your transactions and balances, never your bank password, and it can't move your money.</li>
      <li><strong>Swaps are suggestions.</strong> An AI finds them, so check the label and the price before you buy. Some links earn Margo a commission, including as an Amazon Associate.</li>
      <li><strong>Your data is yours.</strong> You can disconnect a bank, download your data or delete it anytime in Settings. Margo never sells your personal information.</li>
    </ul>
    <label className="m-agree-check">
      <input type="checkbox" checked={checked} onChange={(event) => setChecked(event.target.checked)} data-testid="checkbox-agree" />
      <span>I am 18 or older, and I agree to Margo's <a href={`${import.meta.env.BASE_URL}terms`} target="_blank" rel="noreferrer">Terms of Use</a>, <a href={`${import.meta.env.BASE_URL}privacy`} target="_blank" rel="noreferrer">Privacy Policy</a> and <a href={`${import.meta.env.BASE_URL}disclosures`} target="_blank" rel="noreferrer">Affiliate Disclosure</a>.</span>
    </label>
    {error && <p className="m-error" role="alert">{error}</p>}
    <button type="button" className="m-btn navy" disabled={!checked || save.isPending} onClick={() => void agree()} data-testid="button-agree">{save.isPending ? 'Saving…' : 'I agree, let\'s go'}</button>
  </main>;
}
