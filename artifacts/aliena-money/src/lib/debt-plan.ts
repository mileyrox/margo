/*
 * Debt payoff math. Month by month: interest is added, every debt gets its minimum, and any extra money goes to one
 * target debt. When a debt is paid off, its minimum rolls into the next target ("snowballing" the payments).
 *   Avalanche: target the highest interest rate first (least interest overall).
 *   Snowball: target the smallest balance first (quickest wins).
 */
export type Debt = { id: string; name: string; balance: number; apr: number; minPayment: number; aprEstimated?: boolean; minEstimated?: boolean; source: 'bank' | 'manual' };
export type Strategy = 'avalanche' | 'snowball';
export type PlanResult = {
  months: number; totalInterest: number; totalPaid: number; payable: boolean;
  order: Array<{ id: string; name: string; paidOffMonth: number }>;
  firstMonth: Array<{ id: string; name: string; payment: number; isTarget: boolean }>;
};

const MAX_MONTHS = 600;

/** A typical minimum when the bank doesn't tell us: about 1% of the balance plus that month's interest, at least $25. */
export function estimateMinimum(balance: number, apr: number) {
  return Math.min(balance, Math.max(25, Math.round(balance * 0.01 + balance * (apr / 100 / 12))));
}

export function payoffPlan(input: Debt[], extra: number, strategy: Strategy): PlanResult {
  const debts = input.filter((debt) => debt.balance > 0.5).map((debt) => ({ ...debt, left: debt.balance }));
  const order: PlanResult['order'] = [];
  let months = 0, totalInterest = 0, totalPaid = 0;
  let firstMonth: PlanResult['firstMonth'] = [];
  // The total monthly budget for debt stays the same as debts are paid off, so freed-up minimums roll forward.
  const monthlyBudget = debts.reduce((sum, debt) => sum + debt.minPayment, 0) + Math.max(0, extra);
  const pick = () => {
    const open = debts.filter((debt) => debt.left > 0.005);
    if (!open.length) return null;
    return open.sort((a, b) => strategy === 'avalanche' ? b.apr - a.apr || a.left - b.left : a.left - b.left || b.apr - a.apr)[0];
  };
  while (debts.some((debt) => debt.left > 0.005) && months < MAX_MONTHS) {
    months += 1;
    for (const debt of debts) {
      if (debt.left <= 0.005) continue;
      const interest = debt.left * (debt.apr / 100 / 12);
      debt.left += interest; totalInterest += interest;
    }
    let budget = monthlyBudget;
    const paid = new Map<string, number>();
    for (const debt of debts) {
      if (debt.left <= 0.005) continue;
      const pay = Math.min(debt.left, debt.minPayment, budget);
      debt.left -= pay; budget -= pay; paid.set(debt.id, (paid.get(debt.id) || 0) + pay);
    }
    const target = pick();
    // Whatever is left this month goes to the target, then the next one if the target is finished.
    let next = target;
    while (budget > 0.005 && next) {
      const pay = Math.min(next.left, budget);
      next.left -= pay; budget -= pay; paid.set(next.id, (paid.get(next.id) || 0) + pay);
      next = pick();
    }
    totalPaid += monthlyBudget - budget;
    if (months === 1) firstMonth = input.filter((debt) => debt.balance > 0.5).map((debt) => ({ id: debt.id, name: debt.name, payment: Math.round((paid.get(debt.id) || 0) * 100) / 100, isTarget: debt.id === target?.id }));
    for (const debt of debts) if (debt.left <= 0.005 && !order.some((item) => item.id === debt.id)) { debt.left = 0; order.push({ id: debt.id, name: debt.name, paidOffMonth: months }); }
    // Payments that don't cover the interest never finish.
    if (months === 24 && debts.reduce((sum, debt) => sum + debt.left, 0) >= input.reduce((sum, debt) => sum + debt.balance, 0)) break;
  }
  const payable = debts.every((debt) => debt.left <= 0.005);
  return { months, totalInterest: Math.round(totalInterest), totalPaid: Math.round(totalPaid), payable, order, firstMonth };
}

/** "Aug 2027" for a number of months from now. */
export function monthLabel(monthsFromNow: number, from = new Date()) {
  const date = new Date(from.getFullYear(), from.getMonth() + monthsFromNow, 1);
  return date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}
