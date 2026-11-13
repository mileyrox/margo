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

/** Card and loan payments and transfers, recognized by name, in case the bank filed them under a spending category. */
const PAYMENT_NAME = /\b(payment to .*(card|loan)|card ?payment|crd ?pmt|autopay|payment thank you|loan pmt|e-?pay(ment)?|cardmember serv|transfer to|online transfer|xfer)\b/i;
export const looksLikePayment = (label: string | null | undefined) => PAYMENT_NAME.test(label || '');

export const isSpending = (tx: Pick<Transaction, 'type' | 'category' | 'label'>) => tx.type === 'expense' && !BILLS.has(tx.category) && !MONEY_MOVES.has(tx.category) && tx.category !== NEEDS_A_LOOK && !looksLikePayment(tx.label);
export const isIncome = (tx: Pick<Transaction, 'type' | 'category'>) => tx.type === 'income' && !NOT_INCOME.has(tx.category);
export const isMoneyMove = (tx: Pick<Transaction, 'type' | 'category' | 'label'>) => tx.type === 'expense' && (BILLS.has(tx.category) || MONEY_MOVES.has(tx.category) || looksLikePayment(tx.label));
export const needsALook = (tx: Pick<Transaction, 'type' | 'category'>) => tx.type === 'expense' && tx.category === NEEDS_A_LOOK;
