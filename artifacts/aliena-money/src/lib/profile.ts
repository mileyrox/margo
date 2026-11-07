import { useQueryClient } from '@tanstack/react-query';
import { getGetSwapProfileQueryKey, useGetSwapProfile, useUpdateSwapProfile } from '@workspace/api-client-react';
import type { SwapProfileInput } from '@workspace/api-client-react';

export const blankProfile: SwapProfileInput = {
  savingFor: '', monthlySavingsGoal: 0, nonNegotiables: [], swapCategories: [], favoriteBrands: [], values: [], dietaryNeeds: '', productPreferences: '',
};

/**
 * Small extras (avatar, saved swaps, switched swaps) live inside the swap profile's
 * onboardingAnswers map so they follow the user across devices without a schema change.
 */
export function useProfileAnswers() {
  const qc = useQueryClient();
  const profile = useGetSwapProfile();
  const save = useUpdateSwapProfile();
  const answers = profile.data?.onboardingAnswers || {};
  const patch = async (changes: Record<string, string>) => {
    const current = profile.data || blankProfile;
    const next: SwapProfileInput = { ...blankProfile, ...current, onboardingAnswers: { ...(current.onboardingAnswers || {}), ...changes } };
    qc.setQueryData(getGetSwapProfileQueryKey(), next);
    await save.mutateAsync({ data: next });
    await qc.invalidateQueries({ queryKey: getGetSwapProfileQueryKey() });
  };
  return { profile, answers, patch, saving: save.isPending };
}
