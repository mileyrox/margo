import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AmountEntry } from '@/components/margo/amount-entry';
import { monthlyEquivalent, type AmountPeriod } from '@/lib/amount-period';

function AmountEntryFixture() {
  const params = new URLSearchParams(window.location.search);
  const [amount, setAmount] = useState(params.get('amount') || '');
  const [period, setPeriod] = useState<AmountPeriod>(params.get('period') === 'year' ? 'year' : 'month');

  return <main>
    <AmountEntry
      amount={amount}
      period={period}
      periods={['month', 'year']}
      onAmountChange={setAmount}
      onPeriodChange={setPeriod}
      onSubmit={() => undefined}
    />
    <output aria-label="Monthly equivalent">
      Monthly equivalent: ${monthlyEquivalent(Number(amount) || 0, period).toFixed(2)}
    </output>
  </main>;
}

createRoot(document.getElementById('root')!).render(<AmountEntryFixture />);
