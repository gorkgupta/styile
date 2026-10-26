import { Icon } from '@/components/ui/icons';

// The product's most characteristic moment, as a static composition:
// a client asks on WhatsApp in plain words, the assistant offers a time, and the booking lands on Priya's column.
// One entrance sequence (CSS only, see .mk-hero-visual in globals.css); reduced motion shows the end state.

const HOURS = ['3 PM', '4 PM', '5 PM', '6 PM', '7 PM'];
const HOUR_PX = 60;
const top = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return ((h - 15) * 60 + m) * (HOUR_PX / 60);
};

interface DemoAppt { name: string; service?: string; from: string; to: string; isNew?: boolean }
const COLS: { name: string; initials: string; color: string; appts: DemoAppt[] }[] = [
  { name: 'Priya', initials: 'PN', color: '#7A3FB8', appts: [
    { name: 'Rohan M.', from: '15:00', to: '15:30' },
    { name: 'Divya S.', service: 'Root touch-up', from: '15:45', to: '16:45' },
    { name: 'Ananya K.', service: 'Haircut & style', from: '17:15', to: '18:15', isNew: true },
  ] },
  { name: 'Meera', initials: 'MI', color: '#C2541B', appts: [
    { name: 'Lakshmi M.', service: 'Global colour', from: '15:00', to: '17:00' },
    { name: 'Fatima B.', service: 'Clean-up', from: '17:30', to: '18:15' },
    { name: 'Karthik R.', from: '18:30', to: '19:00' },
  ] },
];

export function HeroVisual() {
  return (
    <div className="mk-hero-visual" aria-label="A client books a haircut on WhatsApp and it appears on the stylist's calendar" role="img">
      <div className="mk-phone">
        <div className="mk-phone-head">
          <span className="mk-phone-avatar">GS</span>
          <div className="grow">
            <div className="mk-phone-name">Glow Studio</div>
            <div className="mk-phone-sub">Business account</div>
          </div>
          <Icon name="phone" size={16} />
        </div>
        <div className="mk-chat">
          <div className="mk-day">Today</div>
          <div className="mk-bubble mk-out mk-seq-1">Hi! Can I get a haircut tomorrow around 5?<span className="mk-ts">4:02 PM</span></div>
          <div className="mk-bubble mk-in mk-seq-2">
            Priya is free tomorrow at <b>5:15 PM</b> for Haircut &amp; style (1 hr, ₹900). Shall I book it?
            <span className="mk-ts">4:02 PM</span>
          </div>
          <div className="mk-wa-buttons mk-seq-2">
            <span>Yes, book it</span>
            <span>Other times</span>
          </div>
          <div className="mk-bubble mk-out mk-seq-3">Yes, book it<span className="mk-ts">4:03 PM</span></div>
          <div className="mk-bubble mk-in mk-seq-4">
            Booked ✅ Haircut &amp; style with Priya, Wed 28 Oct at 5:15 PM. Reply here any time to change it.
            <span className="mk-ts">4:03 PM</span>
          </div>
        </div>
      </div>

      <div className="mk-cal" aria-hidden>
        <div className="mk-cal-top">
          <span className="strong">Wed, 28 Oct</span>
          <span className="mk-cal-toast mk-seq-5"><Icon name="whatsapp" size={13} />New booking</span>
        </div>
        <div className="mk-cal-heads">
          <span />
          {COLS.map((c) => (
            <div key={c.name} className="row" style={{ gap: 8 }}>
              <span className="avatar avatar-sm" style={{ background: c.color }}>{c.initials}</span>
              <span className="small strong truncate">{c.name}</span>
            </div>
          ))}
        </div>
        <div className="mk-cal-body">
          <div className="mk-cal-gutter">
            {HOURS.map((h) => <div key={h} style={{ height: HOUR_PX }}>{h}</div>)}
          </div>
          {COLS.map((c) => (
            <div key={c.name} className="mk-cal-col" style={{ height: HOURS.length * HOUR_PX }}>
              {c.appts.map((a) => (
                <div key={a.name} className={a.isNew ? 'appt mk-landing-block' : 'appt'}
                  style={{ ['--appt-color' as string]: c.color, top: top(a.from), height: top(a.to) - top(a.from) - 3 }}>
                  <div className="between" style={{ gap: 4 }}>
                    <div className="appt-name truncate">{a.name}</div>
                    {a.isNew && <Icon name="whatsapp" size={13} style={{ color: '#1f7a4d', flex: 'none' }} />}
                  </div>
                  {a.service && <div className="appt-meta truncate">{a.service}</div>}
                  {a.isNew && <div className="appt-meta num">5:15 – 6:15 PM</div>}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
