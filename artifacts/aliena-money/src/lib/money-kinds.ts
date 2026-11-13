import type { Transaction } from '@workspace/api-client-react';

/*
 * What counts as spending. Bills that are already in the plan (rent, utilities), paying off debt, moving money to
 * savings or between your own accounts are not spending, so they never eat into "left to spend".
 * Refunds and transfers coming back in are not income (and never trigger the "set aside for taxes" question).
 */
export const BILLS = new Set(['Rent', 'Utilities']);
export const MONEY_MOVES = new Set(['Debt payment', 'Savings', 'Transfer']);
export const NEEDS_A_LOOK = 'Needs a look';
const NOT_INCOME = new Set(['Transfer', 'Refund']);

export const isSpending = (tx: Pick<Transaction, 'type' | 'category'>) => tx.type === 'expense' && !BILLS.has(tx.category) && !MONEY_MOVES.has(tx.category) && tx.category !== NEEDS_A_LOOK;
export const isIncome = (tx: Pick<Transaction, 'type' | 'category'>) => tx.type === 'income' && !NOT_INCOME.has(tx.category);
export const isMoneyMove = (tx: Pick<Transaction, 'type' | 'category'>) => tx.type === 'expense' && (BILLS.has(tx.category) || MONEY_MOVES.has(tx.category));
export const needsALook = (tx: Pick<Transaction, 'type' | 'category'>) => tx.type === 'expense' && tx.category === NEEDS_A_LOOK;
