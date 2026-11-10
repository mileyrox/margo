import { useRef } from 'react';
import { ArrowUp } from 'lucide-react';
import { convertAmountPeriod, type AmountPeriod } from '@/lib/amount-period';

type AmountEntryProps = {
  amount: string;
  period: AmountPeriod;
  periods: AmountPeriod[];
  placeholder?: string;
  onAmountChange: (amount: string) => void;
  onPeriodChange: (period: AmountPeriod) => void;
  onSubmit: () => void;
};

export function AmountEntry({
  amount,
  period,
  periods,
  placeholder,
  onAmountChange,
  onPeriodChange,
  onSubmit,
}: AmountEntryProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  const selectPeriod = (nextPeriod: AmountPeriod) => {
    if (nextPeriod === period) return;
    onAmountChange(convertAmountPeriod(amount, period, nextPeriod));
    onPeriodChange(nextPeriod);
    inputRef.current?.focus({ preventScroll: true });
  };

  return <>
    {periods.length > 1 && <div className="m-segment wide">{periods.map((value) => <button
      key={value}
      type="button"
      className={period === value ? 'on' : ''}
      aria-pressed={period === value}
      onPointerDown={(event) => event.preventDefault()}
      onClick={() => selectPeriod(value)}
    >{value === 'month' ? 'Per month' : 'Per year'}</button>)}</div>}
    <div className="m-amount-row">
      <label className="m-amount"><span>$</span><input
        ref={inputRef}
        autoFocus
        inputMode="decimal"
        value={amount}
        onChange={(event) => onAmountChange(event.target.value)}
        placeholder={placeholder}
        aria-label="Amount"
        onKeyDown={(event) => { if (event.key === 'Enter') onSubmit(); }}
      /></label>
      <button type="button" className="m-send" aria-label="Send" onClick={onSubmit}><ArrowUp aria-hidden="true" /></button>
    </div>
  </>;
}
