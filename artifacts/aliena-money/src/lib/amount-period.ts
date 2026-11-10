export type AmountPeriod = 'month' | 'year';

export function monthlyEquivalent(amount: number, period: AmountPeriod) {
  return period === 'year' ? amount / 12 : amount;
}

export function convertAmountPeriod(value: string, from: AmountPeriod, to: AmountPeriod) {
  if (from === to) return value;

  const amount = Number(value.replace(/[$,\s]/g, ''));
  if (!value.trim() || !Number.isFinite(amount)) return value;

  const converted = from === 'month' ? amount * 12 : amount / 12;
  return String(Math.round(converted * 100) / 100);
}
