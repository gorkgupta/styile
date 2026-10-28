// Preview screens for international phone numbers: a client from Bhutan (+975) books online and is added at the desk.
// The Drive helper fills the real screens the way a person would, so the screenshots show the live components.
import { useEffect, type ReactNode } from 'react';
import { BookingFlow, type BookingPageProps } from '../src/components/public/booking-flow';
import { CalendarBoard } from '../src/components/app/calendar';
import { NewAppointmentSheet } from '../src/components/app/appointment-sheets';
import { branch, menu, NOW_ISO, salon, TODAY } from './data';

type Step = () => boolean; // true when done; retried until then

const find = <T extends Element>(sel: string, text?: string) =>
  [...document.querySelectorAll<T>(sel)].find((el) => !text || el.textContent?.trim() === text) ?? null;

/** Sets a React-controlled input's value as if typed or pasted. */
function type(el: HTMLInputElement | null, value: string) {
  if (!el) return false;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
}
const click = (el: HTMLElement | null) => { if (!el || (el as HTMLButtonElement).disabled) return false; el.click(); return true; };

function Drive({ steps, children }: { steps: Step[]; children: ReactNode }) {
  useEffect(() => {
    let i = 0;
    const t = setInterval(() => { if (i >= steps.length) clearInterval(t); else if (steps[i]()) i++; }, 15);
    return () => clearInterval(t);
  }, [steps]);
  return <>{children}</>;
}

const BHUTAN_NUMBER = '+975 17 12 34 56';

function bookingSteps(sendCode: boolean): Step[] {
  const steps: Step[] = [
    () => click(find<HTMLButtonElement>('.bk-time')),
    () => click(find<HTMLButtonElement>('button', 'Continue')),
    () => type(find<HTMLInputElement>('input[autocomplete="name"]'), 'Karma Wangmo'),
    () => type(find<HTMLInputElement>('#bk-phone'), BHUTAN_NUMBER), // pasted with its country code
  ];
  if (sendCode) steps.push(() => click(find<HTMLButtonElement>('button', 'Send code on WhatsApp')));
  return steps;
}

const quickCreateSteps: Step[] = [
  () => type(find<HTMLInputElement>('.sheet input[type="search"]'), BHUTAN_NUMBER),
  () => click(find<HTMLButtonElement>('.sheet button', 'New client')),
  () => type(find<HTMLInputElement>('.sheet .panel input:not([type="tel"])'), 'Karma Wangmo'),
];

export function phoneScreens(bookingProps: BookingPageProps): Record<string, { title: string; render: () => ReactNode }> {
  return {
    '/s/[slug]/bhutan': {
      title: 'Public booking page — confirm with a Bhutan (+975) mobile number',
      render: () => <Drive steps={bookingSteps(false)}><BookingFlow {...bookingProps} initial={{ serviceIds: ['s-cut-w'], staffId: null, step: 3 }} /></Drive>,
    },
    '/s/[slug]/bhutan-code': {
      title: 'Public booking page — WhatsApp code sent to a +975 number',
      render: () => <Drive steps={bookingSteps(true)}><BookingFlow {...bookingProps} initial={{ serviceIds: ['s-cut-w'], staffId: null, step: 3 }} /></Drive>,
    },
    '/app/calendar/new-client-bhutan': {
      title: 'New appointment — add a client with a Bhutan (+975) number',
      render: () => (
        <Drive steps={quickCreateSteps}>
          <CalendarBoard salonId={salon.id} date={TODAY} today={TODAY} nowIso={NOW_ISO} branchHours={branch.business_hours} appointments={[]} menu={menu} canBill />
          <NewAppointmentSheet open onClose={() => {}} menu={menu} date={TODAY} />
        </Drive>
      ),
    },
  };
}
