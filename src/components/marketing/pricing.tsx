'use client';
import { useState } from 'react';
import Link from 'next/link';
import { Segmented } from '@/components/ui/ui';
import { Icon } from '@/components/ui/icons';
import { money } from '@/lib/billing';
import { EXTRA_STAFF_PRICE, GST_RATE, PLANS, TRIAL_DAYS, EXTRA_CONVERSATION_PRICE, YEARLY_FREE_MONTHS, yearlyPrice } from '@/lib/plans';

export function Pricing() {
  const [cycle, setCycle] = useState<'monthly' | 'yearly'>('monthly');
  return (
    <div className="stack-lg">
      <div className="mk-pricing-toggle">
        <Segmented label="Billing cycle" value={cycle} onChange={setCycle}
          options={[{ value: 'monthly', label: 'Monthly' }, { value: 'yearly', label: `Yearly, ${YEARLY_FREE_MONTHS} months free` }]} />
      </div>
      <div className="mk-plans">
        {PLANS.map((p) => (
          <article key={p.id} className={p.popular ? 'mk-plan is-popular' : 'mk-plan'}>
            <div className="between">
              <h3>{p.name}</h3>
              {p.popular && <span className="badge badge-marigold">Most popular</span>}
            </div>
            <p className="muted small">{p.summary}</p>
            <div className="mk-price">
              <span className="num">{money(cycle === 'monthly' ? p.priceMonthly : yearlyPrice(p))}</span>
              <span className="muted">/{cycle === 'monthly' ? 'month' : 'year'} + GST</span>
            </div>
            {cycle === 'yearly' && <p className="tiny muted" style={{ marginTop: -8 }}>Works out to {money(Math.round(yearlyPrice(p) / 12))} a month</p>}
            <ul className="mk-plan-list">
              {p.features.map((f) => <li key={f}><Icon name="check" size={16} />{f}</li>)}
            </ul>
            <Link href={`/signup?plan=${p.id}`} className={p.popular ? 'btn btn-primary btn-block' : 'btn btn-secondary btn-block'}>Start free trial</Link>
          </article>
        ))}
      </div>
      <div className="mk-price-notes small">
        <p>All plans start with a {TRIAL_DAYS}-day free trial with every feature switched on. No card needed.</p>
        <p>Extra staff logins are {money(EXTRA_STAFF_PRICE)} a month each. Extra assistant conversations beyond your plan are {money(EXTRA_CONVERSATION_PRICE)} each.</p>
        <p>Prices are in rupees and exclude {GST_RATE}% GST, which is shown separately on your invoice.</p>
      </div>
    </div>
  );
}
