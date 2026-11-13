import { useQuery, useQueryClient } from '@tanstack/react-query';
import { customFetch } from '@workspace/api-client-react';
import { useProfileAnswers } from '@/lib/profile';
import { estimateMinimum, type Debt } from '@/lib/debt-plan';

export type Account = {
  id: string; name: string; mask: string | null; type: string; subtype: string | null; institution: string | null;
  current: number | null; available: number | null; creditLimit: number | null; apr: number | null; minPayment: number | null;
  isSavings: boolean; isDebt: boolean; updatedAt: string;
};
export type AccountsResponse = { accounts: Account[]; savings: { total: number; changeThisMonth: number; sinceConnected: boolean } | null };
export type ManualDebt = { id: string; name: string; balance: number; apr: number | null; minPayment: number | null };

export const accountsKey = ['accounts'];

export function useAccounts() {
  // Shown alongside other things, so don't hold the screen up: one quick retry, then show what we have.
  return useQuery({ queryKey: accountsKey, queryFn: () => customFetch<AccountsResponse>('/api/accounts'), staleTime: 5 * 60_000, retry: 1, retryDelay: 800 });
}

export function useSaveAccount() {
  const qc = useQueryClient();
  return async (id: string, changes: { apr?: number | null; minPayment?: number | null; hidden?: boolean }) => {
    await customFetch(`/api/accounts/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(changes) });
    await qc.invalidateQueries({ queryKey: accountsKey });
  };
}

/** Typical rates when the bank doesn't share one. Shown as estimates the person can change. */
export function typicalApr(account: { type: string; subtype: string | null }) {
  const sub = (account.subtype || '').toLowerCase();
  if (account.type === 'credit') return 24;
  if (sub.includes('student')) return 6;
  if (sub.includes('auto')) return 8;
  if (sub.includes('mortgage') || sub.includes('home')) return 6.5;
  return 10;
}

export function readManualDebts(raw: unknown): ManualDebt[] {
  try {
    const list = JSON.parse(String(raw || '[]')) as ManualDebt[];
    return Array.isArray(list) ? list.filter((item) => item && typeof item.name === 'string' && Number(item.balance) > 0) : [];
  } catch { return []; }
}

/**
 * Every debt in one list: cards and loans from connected banks, plus ones added by hand.
 * If there are none of either, the rough total from setup stands in, so the plan still works.
 */
export function useDebts() {
  const accounts = useAccounts();
  const { answers, patch, profile } = useProfileAnswers();
  const manual = readManualDebts(answers.debts);
  const bank: Debt[] = (accounts.data?.accounts ?? []).filter((account) => account.isDebt && (account.current ?? 0) > 0.5).map((account) => {
    const balance = account.current ?? 0;
    const apr = account.apr ?? typicalApr(account);
    return {
      id: account.id, name: `${account.institution ? `${account.institution} ` : ''}${account.name}${account.mask ? ` ••${account.mask}` : ''}`,
      balance, apr, aprEstimated: account.apr == null,
      minPayment: account.minPayment ?? estimateMinimum(balance, apr), minEstimated: account.minPayment == null, source: 'bank',
    };
  });
  const added: Debt[] = manual.map((item) => {
    const apr = item.apr ?? 20;
    return { id: item.id, name: item.name, balance: Number(item.balance), apr, aprEstimated: item.apr == null, minPayment: item.minPayment ?? estimateMinimum(Number(item.balance), apr), minEstimated: item.minPayment == null, source: 'manual' };
  });
  const setupBalance = Number(answers.debtBalance || 0);
  const fallback: Debt[] = !bank.length && !added.length && setupBalance > 0
    ? [{ id: 'setup', name: 'Debt from setup', balance: setupBalance, apr: 20, aprEstimated: true, minPayment: Number(answers.debtPayment || 0) || estimateMinimum(setupBalance, 20), minEstimated: !Number(answers.debtPayment || 0), source: 'manual' }]
    : [];
  const saveManual = (next: ManualDebt[]) => patch({ debts: JSON.stringify(next) });
  return {
    debts: [...bank, ...added, ...fallback], manual, saveManual, answers, patch,
    // Only wait for the profile; bank debts slide in when the bank answers.
    loading: profile.isLoading, bankLoading: accounts.isLoading, bankError: accounts.isError, hasBankDebts: bank.length > 0,
  };
}
