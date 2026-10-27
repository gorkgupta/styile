// Styile subscription plans (what salons pay us). Prices are monthly, in rupees, before 18% GST.
// "WhatsApp assistant conversations" are conversations handled by Styile's AI assistant. Meta's own per-message
// charges are billed by Meta to the salon's WhatsApp Business account, not by Styile.
// Used by the landing page (pricing) and the platform console (estimated MRR, plan pickers).

import type { Salon } from './types';

export type PlanId = 'starter' | 'growth' | 'pro';
export type PlanStatus = Salon['plan_status'];

export interface Plan {
  id: PlanId;
  name: string;
  priceMonthly: number;          // ₹ per month, excluding GST
  summary: string;               // one line on who it is for
  staffLimit: number | null;     // staff logins included; null = unlimited
  branches: number | null;       // null = multiple branches
  waConversations: number;       // WhatsApp assistant conversations per month
  features: string[];
  popular?: boolean;
}

export const GST_RATE = 18;
export const TRIAL_DAYS = 14;
export const EXTRA_STAFF_PRICE = 199;        // ₹ per extra staff login per month
export const EXTRA_CONVERSATION_PRICE = 0.5; // ₹ per assistant conversation beyond the plan's allowance
export const YEARLY_FREE_MONTHS = 2;

export const PLANS: Plan[] = [
  {
    id: 'starter', name: 'Starter', priceMonthly: 999,
    summary: 'For a single salon with a small team.',
    staffLimit: 3, branches: 1, waConversations: 1000,
    features: ['Up to 3 staff logins', '1 branch', '1,000 WhatsApp assistant conversations a month', 'Online booking page', 'GST billing with UPI, card and cash'],
  },
  {
    id: 'growth', name: 'Growth', priceMonthly: 2499, popular: true,
    summary: 'For busy salons that want to see the numbers.',
    staffLimit: 10, branches: 1, waConversations: 3000,
    features: ['Up to 10 staff logins', 'Everything in Starter', '3,000 WhatsApp assistant conversations a month', 'Reports and stylist commissions', 'WhatsApp campaigns (coming soon)'],
  },
  {
    id: 'pro', name: 'Pro', priceMonthly: 4999,
    summary: 'For chains with more than one branch.',
    staffLimit: null, branches: null, waConversations: 8000,
    features: ['Unlimited staff logins', 'Everything in Growth', 'Multiple branches', '8,000 WhatsApp assistant conversations a month', 'Priority support'],
  },
];

export const PLAN_LABEL: Record<Salon['plan'], string> = { trial: 'Free trial', starter: 'Starter', growth: 'Growth', pro: 'Pro' };
export const PLAN_STATUS_LABEL: Record<PlanStatus, string> = {
  trialing: 'Trial', active: 'Active', past_due: 'Payment due', suspended: 'Suspended', cancelled: 'Cancelled',
};

export function planById(id: string | null | undefined): Plan | undefined {
  return PLANS.find((p) => p.id === id);
}

/** Yearly price: pay for 10 months, get 12. */
export function yearlyPrice(plan: Plan): number {
  return plan.priceMonthly * (12 - YEARLY_FREE_MONTHS);
}

export function withGst(amount: number): number {
  return Math.round(amount * (1 + GST_RATE / 100));
}

/** Monthly recurring revenue a salon contributes (before GST). Trials and unpaid accounts count as zero. */
export function monthlyRevenue(salon: Pick<Salon, 'plan' | 'plan_status'>): number {
  if (salon.plan_status !== 'active') return 0;
  return planById(salon.plan)?.priceMonthly ?? 0;
}
