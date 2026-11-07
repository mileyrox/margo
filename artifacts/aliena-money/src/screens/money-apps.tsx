import { useState } from 'react';
import { useGetFinanceDashboard } from '@workspace/api-client-react';
import { ArrowUpRight } from 'lucide-react';
import { PageTitle } from '@/components/margo/chrome';
import { money } from '@/lib/format';

/**
 * Apps Miley has used herself. To add a referral link, replace `url`.
 * Fill in `helped` with a sentence in your own words and it shows as "How it helped me".
 */
type MoneyApp = { name: string; initial: string; kind: string; tag: 'Earn' | 'Save'; value: string; note: string; helped: string; url: string };

export const moneyApps: MoneyApp[] = [
  { name: 'Instawork', initial: 'I', kind: 'Flexible hourly shifts', tag: 'Earn', value: 'Hourly pay, set per shift', note: 'Shifts vary by city', helped: '', url: 'https://www.instawork.com/' },
  { name: 'Qwick', initial: 'Q', kind: 'Hospitality shifts', tag: 'Earn', value: 'Hourly pay, set per shift', note: 'Mostly food and bev', helped: '', url: 'https://www.qwick.com/' },
  { name: 'Instacart Shopper', initial: 'C', kind: 'Grocery shopping and delivery', tag: 'Earn', value: 'Per order, plus tips', note: 'Gas and car costs add up', helped: '', url: 'https://shoppers.instacart.com/' },
  { name: 'Kale', initial: 'K', kind: 'Brands pay you for short videos', tag: 'Earn', value: 'Paid brand deals and prizes', note: 'No follower minimum', helped: '', url: 'https://www.kale.com/' },
  { name: 'User Interviews', initial: 'U', kind: 'Paid research studies', tag: 'Earn', value: 'Set by each study', note: "Invites aren't guaranteed", helped: '', url: 'https://www.userinterviews.com/' },
  { name: 'Lemonade Pet', initial: 'L', kind: 'Pet insurance', tag: 'Save', value: 'Fewer surprise vet bills', note: 'Read the waiting periods', helped: '', url: 'https://www.lemonade.com/pet' },
  { name: 'Kayak', initial: 'K', kind: 'Compare flights and hotels', tag: 'Save', value: 'Price alerts on trips', note: 'Prices change fast', helped: '', url: 'https://www.kayak.com/' },
];

export function MoneyAppsPage() {
  const dashboard = useGetFinanceDashboard();
  const [filter, setFilter] = useState<'All' | 'Earn' | 'Save'>('All');
  const apps = moneyApps.filter((app) => filter === 'All' || app.tag === filter);
  return <div className="m-page">
    <PageTitle title="Money apps" subtitle="Apps that have helped me earn extra or spend less. I've used every one." />
    <div className="m-chips" role="group" aria-label="Filter apps">
      {(['All', 'Earn', 'Save'] as const).map((value) => <button key={value} className={`m-chip ${filter === value ? 'on' : ''}`} aria-pressed={filter === value} onClick={() => setFilter(value)}>{value}</button>)}
    </div>
    {filter !== 'Save' && <div className="m-navy-strip two">
      <div><span>Extra income this year</span><strong>{money(dashboard.data?.taxableIncomeThisYear)}</strong></div>
      <div className="end"><span>Set aside for taxes</span><strong>{money(dashboard.data?.taxSetAside)}</strong></div>
    </div>}
    {apps.map((app) => <article className="m-card m-stack" key={app.name}>
      <div className="m-app-head">
        <span className={`m-app-tile ${app.tag === 'Earn' ? 'earn' : 'save'}`} aria-hidden="true">{app.initial}</span>
        <span><strong>{app.name}</strong><small className="m-muted">{app.kind}</small></span>
        <span className={`m-pill ${app.tag === 'Earn' ? 'navy' : 'olive'}`}>{app.tag}</span>
      </div>
      <div className="m-two-col">
        <div><small className="m-muted">{app.tag === 'Earn' ? 'What you can earn' : 'How it saves'}</small><strong>{app.value}</strong></div>
        <div><small className="m-muted">Good to know</small><strong>{app.note}</strong></div>
      </div>
      {app.helped && <div className="m-quote"><small>How it helped me</small><span>{app.helped}</span></div>}
      <a className="m-btn navy" href={app.url} target="_blank" rel="noreferrer sponsored">{app.tag === 'Earn' ? 'Try it' : 'Check it out'}<ArrowUpRight aria-hidden="true" /></a>
    </article>)}
    <p className="m-fine">Some links are referral or affiliate links, so I may earn a bonus if you sign up. I only list apps I've used myself. Pay and availability vary by location.</p>
  </div>;
}
