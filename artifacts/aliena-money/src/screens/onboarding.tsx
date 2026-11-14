import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetBudgetPlanQueryKey, getGetSwapProfileQueryKey, useGetBudgetPlan, useGetSwapProfile, useUpdateBudgetPlan, useUpdateSwapProfile,
} from '@workspace/api-client-react';
import type { BudgetPlanInput, SwapProfileInput } from '@workspace/api-client-react';
import { ArrowLeft, Check } from 'lucide-react';
import { ErrorState, Skeleton } from '@/components/margo/chrome';
import { MargoFace } from '@/components/margo/characters';
import { AmountEntry } from '@/components/margo/amount-entry';
import { monthlyEquivalent } from '@/lib/amount-period';
import { blankProfile } from '@/lib/profile';
import { messageOf, money, parseList } from '@/lib/format';
import { BankConnect, swapCategoryOptions } from './settings';

type Answers = Record<string, string>;
type Step = {
  id: string;
  type: 'choice' | 'amount' | 'multi' | 'budget' | 'bank' | 'end';
  say: (a: Answers) => string[];
  options?: string[];
  units?: Array<'month' | 'year'>;
  /** A balance owed, not a monthly amount. */
  total?: boolean;
  placeholder?: string;
  skip?: string;
  /** "I'm not sure": Margo fills in a suggested monthly amount instead. */
  suggest?: (a: Answers) => number;
  none?: string;
  otherInput?: boolean;
  show?: (a: Answers) => boolean;
};

const otherBillEstimates: Record<string, number> = { 'Car insurance': 140, Utilities: 110, Internet: 60, Gym: 40, Childcare: 600, Insurance: 100 };
const swapLabelToKey: Record<string, SwapProfileInput['swapCategories'][number]> = { Groceries: 'groceries', Household: 'household', 'Personal care': 'beauty', Clothing: 'clothes', Subscriptions: 'subscriptions', Travel: 'travel' };
const swapOptions = [...swapCategoryOptions.map(([, label]) => label), 'Other'];
const split = [['Groceries', 0.4], ['Transportation', 0.2], ['Dining out', 0.15], ['Shopping', 0.12], ['Personal care', 0.08], ['Subscriptions', 0.05]] as const;

const monthly = (a: Answers, key: string) => {
  const value = Math.max(0, Number(a[key]) || 0);
  return monthlyEquivalent(value, a[`${key}Period`] === 'year' ? 'year' : 'month');
};

const steps: Step[] = [
  { id: 'hi', type: 'choice', say: () => ["Hi, I'm Margo.", "I'll ask a few quick questions and build you a budget. Takes about two minutes."], options: ["Let's go"] },
  { id: 'takeHome', type: 'amount', units: ['month', 'year'], placeholder: '3,200', say: () => ['First up: how much do you take home after taxes?', 'A rough number is fine.'] },
  { id: 'sideGig', type: 'choice', say: (a) => [`Got it, about ${money(monthly(a, 'takeHome'))} a month.`, 'Do you also earn from side gigs? Shifts, rideshare, freelancing, anything like that.'], options: ['Yes', 'No'] },
  { id: 'savingsGoal', type: 'amount', units: ['year', 'month'], placeholder: '6,000', suggest: (a) => Math.round(monthly(a, 'takeHome') * 0.2 / 10) * 10, say: (a) => [...(a.sideGig === 'Yes' ? ["Nice. I'll flag gig money and suggest setting aside 25% for taxes."] : []), 'How much do you want to save?'] },
  { id: 'savingFor', type: 'choice', say: (a) => {
    const income = monthly(a, 'takeHome'); const pct = income ? Math.round(monthly(a, 'savingsGoal') / income * 100) : 0;
    const first = a.savingsGoalSuggested === 'yes'
      ? `No problem. A common goal is about 20% of take-home, so let's start with ${money(monthly(a, 'savingsGoal'))} a month. If that feels like a stretch, you can lower it anytime.`
      : `That's ${money(monthly(a, 'savingsGoal'))} a month, about ${pct}% of your take-home.`;
    return [first, "What's your biggest money goal right now?"];
  }, options: ['Build an emergency fund', 'Pay off debt', 'Save for something big', 'Buy a home', 'Invest for later', 'Just spend less'] },
  { id: 'nonNegotiables', type: 'multi', say: () => ['Good one. Now the important part.', "What will you never give up? I won't suggest swaps for these."], options: swapOptions, otherInput: true, none: "Nothing, I'm flexible" },
  { id: 'swapCategories', type: 'multi', say: () => ['Noted.', 'Where should I look for cheaper options?'], options: swapOptions, otherInput: true },
  { id: 'rent', type: 'amount', units: ['month'], placeholder: '1,450', say: () => ["Now your regular bills. What's your rent or mortgage?"], skip: "I don't pay rent" },
  { id: 'carPayment', type: 'amount', units: ['month'], placeholder: '350', say: () => ['Car payment?'], skip: 'No car payment' },
  { id: 'carBalance', type: 'amount', total: true, units: ['month'], placeholder: '14,000', show: (a) => monthly(a, 'carPayment') > 0, say: () => ['About how much do you still owe on the car?'], skip: "I'm not sure" },
  { id: 'phoneBill', type: 'amount', units: ['month'], placeholder: '85', say: () => ['Phone bill?'], skip: 'Someone else pays it' },
  { id: 'pets', type: 'choice', say: () => ['Any pets?'], options: ['Yes', 'No'] },
  { id: 'petCosts', type: 'amount', units: ['month'], placeholder: '120', show: (a) => a.pets === 'Yes', say: () => ['About how much a month on food, vet, and insurance?'] },
  { id: 'otherBillsList', type: 'multi', say: () => ['Anything else you pay every month?'], options: Object.keys(otherBillEstimates), none: "That's it" },
  { id: 'hasDebt', type: 'choice', say: (a) => [parseList(a.otherBillsList).length ? "I'll estimate those for now. You can fix the amounts later." : 'Got it.', 'Are you paying off any other debt? Not counting your car payment.'], options: ['Yes', 'No debt'] },
  { id: 'debtTypes', type: 'multi', show: (a) => a.hasDebt === 'Yes', say: () => ['No judgment here. What kind?'], options: ['Credit card', 'Student loan', 'Personal loan', 'Medical bills'] },
  { id: 'debtBalance', type: 'amount', total: true, units: ['month'], placeholder: '3,200', show: (a) => a.hasDebt === 'Yes', say: () => ['Roughly how much is left to pay, all together? Leave out the car.'] },
  { id: 'debtPayment', type: 'amount', units: ['month'], placeholder: '360', show: (a) => a.hasDebt === 'Yes', say: () => ['And about how much do you pay toward it each month?'] },
  { id: 'budget', type: 'budget', say: () => ["Okay, here's your starting budget. I used your answers, plus typical spending for everything else."], options: ['Looks good', "I'll tweak it later"] },
  { id: 'connect', type: 'bank', say: () => ['Last thing. Want me to connect your bank so your budget tracks itself?', "I can see purchases and balances. I can't move your money."] },
  { id: 'done', type: 'end', say: (a) => [a.connect === 'Connected' ? "Connected. I'm pulling in your recent purchases now." : 'No problem, you can connect anytime in Settings.', "You're all set. Welcome to Margo."] },
];

function budgetFor(a: Answers) {
  const income = monthly(a, 'takeHome');
  const save = monthly(a, 'savingsGoal');
  const fixed: Array<[string, number]> = [
    ['Rent', monthly(a, 'rent')], ['Car payment', monthly(a, 'carPayment')], ['Phone', monthly(a, 'phoneBill')],
    ['Pets', a.pets === 'Yes' ? monthly(a, 'petCosts') : 0],
    ...parseList(a.otherBillsList).map((name) => [name, otherBillEstimates[name] || 0] as [string, number]),
    ['Debt payments', a.hasDebt === 'Yes' ? monthly(a, 'debtPayment') : 0],
  ];
  const fixedRows = fixed.filter(([, amount]) => amount > 0);
  const fixedTotal = fixedRows.reduce((sum, [, amount]) => sum + amount, 0);
  const left = income - save - fixedTotal;
  return { income, save, fixedRows, left, flexible: split.map(([name, share]) => [name, Math.max(0, Math.round(left * share))] as const) };
}

function reply(step: Step, a: Answers) {
  const value = a[step.id];
  if (step.type === 'amount' && a[`${step.id}Suggested`] === 'yes') return "I'm not sure";
  if (step.type === 'amount') return value === 'skipped' ? step.skip : step.total ? `About ${money(value)}` : `${money(value)} a ${a[`${step.id}Period`] || step.units?.[0] || 'month'}`;
  if (step.type === 'multi') { const list = parseList(value); return list.length ? list.join(', ') : step.none || 'None'; }
  return value;
}

export function OnboardingPage() {
  const qc = useQueryClient();
  const [, setLocation] = useLocation();
  const profileQuery = useGetSwapProfile();
  const planQuery = useGetBudgetPlan();
  const saveProfile = useUpdateSwapProfile();
  const savePlan = useUpdateBudgetPlan();
  const [answers, setAnswers] = useState<Answers>({});
  const [pos, setPos] = useState('hi');
  const [draft, setDraft] = useState('');
  const [unit, setUnit] = useState<'month' | 'year'>('month');
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const initialized = useRef(false);
  const chatRef = useRef<HTMLDivElement>(null);

  const visible = useMemo(() => steps.filter((step) => !step.show || step.show(answers)), [answers]);
  const current = visible.find((step) => step.id === pos) || visible[0];
  const index = visible.indexOf(current);
  const progress = Math.round(index / (visible.length - 1) * 100);

  useEffect(() => {
    if (initialized.current || profileQuery.isLoading) return;
    initialized.current = true;
    const saved = profileQuery.data?.onboardingAnswers;
    if (saved) setAnswers(Object.fromEntries(Object.entries(saved).filter(([key]) => ['avatar', 'savedSwaps', 'switchedSwaps'].includes(key))));
  }, [profileQuery.data, profileQuery.isLoading]);
  useEffect(() => {
    const saved = answers[current.id];
    const savedItems = current.type === 'multi' ? parseList(saved) : [];
    const unmatched = current.otherInput ? savedItems.filter((item) => !current.options?.includes(item)) : [];
    setDraft(current.type === 'amount' && saved && saved !== 'skipped' ? saved : unmatched[0] || '');
    setSelected(current.type === 'multi'
      ? current.otherInput
        ? [...savedItems.filter((item) => current.options?.includes(item)), ...(unmatched.length ? ['Other'] : [])]
        : savedItems
      : []);
    setError('');
    setUnit((answers[`${current.id}Period`] as 'month' | 'year') || current.units?.[0] || 'month');
  }, [current.id, answers]);
  useEffect(() => {
    const el = chatRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [current.id, error]);

  // Phones: when the keyboard opens, fit the chat to the space above it, so the newest message and the
  // text box both stay on screen (instead of the page jumping around).
  const shellRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const view = window.visualViewport;
    const root = document.documentElement;
    root.classList.add('m-chat-open');
    if (!view) return () => root.classList.remove('m-chat-open');
    const fit = () => {
      const shell = shellRef.current;
      if (!shell) return;
      shell.style.setProperty('--vv-h', `${Math.round(view.height)}px`);
      shell.style.setProperty('--vv-top', `${Math.round(view.offsetTop)}px`);
      const el = chatRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    };
    fit();
    view.addEventListener('resize', fit);
    view.addEventListener('scroll', fit);
    return () => { view.removeEventListener('resize', fit); view.removeEventListener('scroll', fit); root.classList.remove('m-chat-open'); };
  }, []);

  const advance = (next: Answers) => {
    const list = steps.filter((step) => !step.show || step.show(next));
    const i = list.findIndex((step) => step.id === current.id);
    setAnswers(next);
    setPos(list[Math.min(list.length - 1, i + 1)].id);
  };
  const goBack = () => {
    if (index > 0) setPos(visible[index - 1].id);
  };
  const answer = (value: string, extra: Answers = {}) => advance({ ...answers, [current.id]: value, ...extra });
  const sendAmount = () => {
    const value = Number(draft.replace(/[$,\s]/g, ''));
    if (!draft.trim() || !Number.isFinite(value) || value < 0) { setError('Enter an amount, even a rough one.'); return; }
    answer(String(value), { [`${current.id}Period`]: unit, [`${current.id}Suggested`]: '' });
  };
  const sendMulti = () => {
    if (current.otherInput && selected.includes('Other')) {
      const other = draft.trim();
      if (!other) { setError('Add what you would never give up.'); return; }
      answer(JSON.stringify([...new Set([...selected.filter((item) => item !== 'Other'), other])]));
      return;
    }
    answer(JSON.stringify(selected));
  };
  const restart = () => { setAnswers((a) => Object.fromEntries(Object.entries(a).filter(([key]) => ['avatar', 'savedSwaps', 'switchedSwaps'].includes(key)))); setPos('hi'); };

  const finish = async () => {
    setBusy(true); setError('');
    const plan = budgetFor(answers);
    const swapLabels = parseList(answers.swapCategories);
    const otherBills = parseList(answers.otherBillsList).reduce((sum, name) => sum + (otherBillEstimates[name] || 0), 0);
    const stored: Answers = {
      ...answers,
      // Keep the record of the sign-up agreement.
      ...(profileQuery.data?.onboardingAnswers?.agreedAt ? { agreedAt: profileQuery.data.onboardingAnswers.agreedAt, agreedVersion: profileQuery.data.onboardingAnswers.agreedVersion || '' } : {}),
      otherBills: String(otherBills),
      debtStartBalance: answers.debtBalance || '',
      hasDebt: answers.hasDebt === 'Yes' ? 'Yes' : 'No',
      rent: answers.rent === 'skipped' ? '0' : answers.rent || '0',
      carPayment: answers.carPayment === 'skipped' ? '0' : answers.carPayment || '0',
      carBalance: answers.carPayment === 'skipped' || answers.carBalance === 'skipped' ? '' : answers.carBalance || '',
      phoneBill: answers.phoneBill === 'skipped' ? '0' : answers.phoneBill || '0',
    };
    const profile: SwapProfileInput = {
      ...blankProfile,
      ...(profileQuery.data || {}),
      savingFor: answers.savingFor || '',
      monthlySavingsGoal: Math.round(plan.save),
      nonNegotiables: parseList(answers.nonNegotiables),
      swapCategories: swapLabels.flatMap((label) => swapLabelToKey[label] ? [swapLabelToKey[label]] : []),
      onboardingAnswers: stored,
    };
    const budget: BudgetPlanInput = {
      annualIncome: Math.round(plan.income * 12),
      annualSavingsGoal: Math.round(plan.save * 12),
      monthlyRent: Number(stored.rent) || 0,
      priorityCategories: [],
      categoryBudgets: plan.flexible.map(([category, amount]) => ({ category, monthlyTarget: amount })),
    };
    try {
      await saveProfile.mutateAsync({ data: profile });
      await savePlan.mutateAsync({ data: budget });
      await Promise.all([qc.invalidateQueries({ queryKey: getGetSwapProfileQueryKey() }), qc.invalidateQueries({ queryKey: getGetBudgetPlanQueryKey() })]);
      setLocation('/');
    } catch (reason) { setError(messageOf(reason)); } finally { setBusy(false); }
  };

  if (profileQuery.isLoading || planQuery.isLoading) return <main className="m-chat"><Skeleton lines={5} /></main>;
  if (profileQuery.isError) return <main className="m-chat"><ErrorState error={profileQuery.error} retry={() => profileQuery.refetch()} /></main>;

  const messages: Array<{ kind: 'margo' | 'me' | 'budget'; text: string; first?: boolean }> = [];
  for (const step of visible) {
    step.say(answers).forEach((text, k) => messages.push({ kind: 'margo', text, first: k === 0 }));
    if (step.type === 'budget') messages.push({ kind: 'budget', text: '' });
    if (step.id === current.id) break;
    if (step.type !== 'bank' || answers.connect) messages.push({ kind: 'me', text: step.type === 'bank' ? answers.connect : reply(step, answers) || '' });
  }
  const plan = budgetFor(answers);

  return <main className="m-chat" ref={shellRef}>
    <header className="m-chat-head">
      <div className="m-line">
        {index > 0 ? <button className="m-icon-button" aria-label="Go to previous onboarding step" onClick={goBack}><ArrowLeft aria-hidden="true" /></button> : <span className="m-chat-back-spacer" />}
        <span className="m-chat-brand"><MargoFace size={38} label="" /><span><strong>Margo</strong><small className="m-muted">Setting up your budget</small></span></span>
        <button className="m-link-button" onClick={restart}>Start over</button>
      </div>
      <div className="m-progress"><i style={{ width: `${progress}%` }} /></div>
    </header>
    <div className="m-chat-scroll" ref={chatRef} aria-live="polite">
      {messages.map((message, i) => message.kind === 'margo'
        ? <div className={`m-bubble-row ${message.first ? 'first' : ''}`} key={i}><span className="m-bubble-seal">{message.first && <MargoFace size={30} label="" />}</span><p className="m-bubble margo">{message.text}</p></div>
        : message.kind === 'me'
          ? <div className="m-bubble-row me" key={i}><p className="m-bubble me">{message.text}</p></div>
          : <div className="m-bubble-row" key={i}><span className="m-bubble-seal" /><div className="m-budget-card">
            <strong>Your monthly budget</strong>
            <div><span><b>Take-home</b></span><b>{money(plan.income)}</b></div>
            <div><span>Savings</span><b className="olive">−{money(plan.save)}</b></div>
            {plan.fixedRows.map(([name, amount]) => <div key={name}><span>{name}</span><b>−{money(amount)}</b></div>)}
            {plan.left > 0 ? <>{plan.flexible.map(([name, amount]) => <div key={name}><span className="m-muted">{name} (estimate)</span><b>−{money(amount)}</b></div>)}<div><span><b>Left unplanned</b></span><b>$0</b></div></>
              : <div className="burgundy"><span><b>You're over by</b></span><b>{money(-plan.left)}</b></div>}
          </div></div>)}
    </div>
    <div className="m-dock">
      {error && <div className="m-error" role="alert">{error}</div>}
      {(current.type === 'choice' || current.type === 'budget') && <div className="m-dock-choices">{(current.options || []).map((option) => <button key={option} className="m-choice" onClick={() => answer(option)}>{option}</button>)}</div>}
      {current.type === 'multi' && <>
        <span className="m-muted small">Tap all that apply</span>
        <div className="m-dock-choices left">{(current.options || []).map((option) => { const on = selected.includes(option); return <button key={option} className={`m-choice ${on ? 'on' : ''}`} aria-pressed={on} onClick={() => setSelected((list) => on ? list.filter((item) => item !== option) : [...list, option])}>{on && <Check aria-hidden="true" />}{option}</button>; })}</div>
        {current.otherInput && selected.includes('Other') && <label className="m-amount"><input autoFocus={typeof window !== 'undefined' && window.matchMedia?.('(pointer: fine)').matches} type="text" autoComplete="off" maxLength={100} value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="What would you never give up?" aria-label="Your other non-negotiable" onKeyDown={(event) => { if (event.key === 'Enter') sendMulti(); }} /></label>}
        <button className="m-btn navy" onClick={sendMulti} disabled={!selected.length && !current.none}>{selected.length ? 'Done' : current.none || 'Pick at least one'}</button>
      </>}
      {current.type === 'amount' && <>
        <AmountEntry
          amount={draft}
          period={unit}
          periods={current.units || ['month']}
          placeholder={current.placeholder}
          onAmountChange={setDraft}
          onPeriodChange={setUnit}
          onSubmit={sendAmount}
        />
        {current.skip && <button className="m-link-button" onClick={() => answer('skipped')}>{current.skip}</button>}
        {current.suggest && (current.suggest(answers) > 0
          ? <button className="m-btn outline m-unsure" onClick={() => answer(String(current.suggest!(answers)), { [`${current.id}Period`]: 'month', [`${current.id}Suggested`]: 'yes' })}>I'm not sure, suggest one</button>
          : null)}
      </>}
      {current.type === 'bank' && <><BankConnect compact onConnected={() => answer('Connected', { connect: 'Connected' })} /><button className="m-btn outline" onClick={() => answer('Not now', { connect: 'Not now' })}>Not now</button></>}
      {current.type === 'end' && <button className="m-btn burgundy" disabled={busy} onClick={() => void finish()}>{busy ? 'Saving your plan…' : 'Go to my home'}</button>}
    </div>
  </main>;
}
