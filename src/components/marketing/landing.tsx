import Link from 'next/link';
import { Icon, type IconName } from '@/components/ui/icons';
import { HeroVisual } from './hero-visual';
import { Pricing } from './pricing';
import { TRIAL_DAYS } from '@/lib/plans';

const FEATURES: { icon: IconName; title: string; body: string }[] = [
  { icon: 'calendar', title: 'Calendar and walk-in tokens', body: 'Every stylist in a column, bookings from WhatsApp and your booking page land on their own. Walk-ins get a token number and wait in a live queue.' },
  { icon: 'receipt', title: 'GST billing', body: 'Bills with CGST and SGST worked out for you. Split a payment across UPI, card and cash, and send the bill to the client on WhatsApp.' },
  { icon: 'users', title: 'Client history and colour notes', body: 'Every visit, every bill, and the notes that matter: shade 5.3 with 20 vol, sensitive scalp, prefers Meera.' },
  { icon: 'wallet', title: 'Team commissions', body: 'Set a commission per stylist. Styile adds up what each person earned from the services they did.' },
  { icon: 'chart', title: 'Reports', body: 'Revenue by day, stylist and service. See how many bookings came from WhatsApp, walk-ins and the phone.' },
  { icon: 'link', title: 'Your own booking page', body: 'Your own address like yoursalon.styile.com for Instagram and Google. Clients pick a service, a stylist and a time, and see their bookings there.' },
];

const STEPS: { title: string; body: string }[] = [
  { title: 'A client messages your salon', body: 'In their own words, in English or Hinglish: “haircut tomorrow around 5?”, “how much is keratin?”, “can I move my Saturday booking?”' },
  { title: 'The assistant checks your real calendar', body: 'It knows your services, prices, stylists and opening hours. It offers times that are actually free and asks the client to confirm.' },
  { title: 'The booking lands on your calendar', body: 'The client gets a confirmation and a reminder before the visit. Anything the assistant can’t answer is handed to your front desk.' },
];

const FAQ: { q: string; a: string }[] = [
  { q: 'Is my salon’s data safe? Can other salons see my clients?', a: 'Each salon’s data is kept separate at the database level, so one salon can never read another’s clients, bills or bookings. Your staff only see what their role allows: stylists don’t see billing or reports. Data is stored on encrypted servers and backed up daily.' },
  { q: 'Does it work on a phone or tablet?', a: 'Yes. Styile runs in the browser on any phone, tablet or computer. Most front desks use a tablet; owners check the day from their phone. You can add it to your home screen like an app.' },
  { q: 'Are the bills GST invoices?', a: 'Yes. Add your GSTIN in settings and every bill shows your GST details, invoice number, CGST and SGST, and the amount in words. Prices can include or exclude GST.' },
  { q: 'What do I need for the WhatsApp assistant?', a: 'A WhatsApp Business number that is not already used in the WhatsApp Business app on a phone (or one you are happy to move to the WhatsApp Cloud API). We help you connect it through Meta Business Manager. Until it’s connected, you can still use the booking page and everything else.' },
  { q: 'Who pays for WhatsApp messages?', a: 'Meta charges a small fee per message (about ₹0.12 for a booking confirmation or reminder in India). Those charges are paid by your salon directly to Meta through your WhatsApp Business account. Your plan covers the assistant conversations that Styile handles; extra assistant conversations are ₹0.50 each.' },
  { q: 'Can I cancel any time?', a: `Yes. There’s no lock-in: cancel from settings and you won’t be billed again. You can export your clients and bills before you go. The ${TRIAL_DAYS}-day trial needs no card, so there’s nothing to cancel if you don’t continue.` },
];

export function LandingPage() {
  return (
    <div className="mk">
      <header className="mk-nav">
        <div className="mk-wrap between">
          <Link href="/" className="mk-logo" aria-label="Styile home"><span className="brand-mark">S</span>Styile</Link>
          <nav className="row mk-nav-links" aria-label="Site">
            <a href="#features" className="hide-mobile">Features</a>
            <a href="#pricing" className="hide-mobile">Pricing</a>
            <a href="#faq" className="hide-mobile">Questions</a>
            <Link href="/login" className="btn btn-ghost btn-sm">Log in</Link>
            <Link href="/signup" className="btn btn-primary btn-sm">Start free trial</Link>
          </nav>
        </div>
      </header>

      <main>
        <section className="mk-hero">
          <div className="mk-wrap mk-hero-grid">
            <div className="mk-hero-copy">
              <h1>Clients message you on WhatsApp. Styile books them in.</h1>
              <p className="mk-lede">
                Salon software for appointments, walk-ins, GST bills and client history, with a WhatsApp assistant that answers
                prices and books free slots while your team is busy with clients.
              </p>
              <div className="row-wrap mk-hero-cta">
                <Link href="/signup" className="btn btn-primary btn-lg">Start free trial</Link>
                <Link href="/login" className="btn btn-secondary btn-lg">Log in</Link>
              </div>
              <p className="small muted">{TRIAL_DAYS} days free, no card needed. Set up in about 10 minutes.</p>
            </div>
            <HeroVisual />
          </div>
        </section>

        <section className="mk-section mk-steps-band" id="assistant">
          <div className="mk-wrap">
            <h2 className="mk-h2">How the WhatsApp assistant works</h2>
            <p className="mk-sub">It runs on your salon’s own WhatsApp number, so clients message the number they already know.</p>
            <ol className="mk-steps">
              {STEPS.map((s, i) => (
                <li key={s.title}>
                  <span className="mk-step-no num" aria-hidden>{i + 1}</span>
                  <h3>{s.title}</h3>
                  <p>{s.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="mk-section" id="features">
          <div className="mk-wrap">
            <h2 className="mk-h2">Everything the front desk needs</h2>
            <p className="mk-sub">One place for the day’s bookings, the walk-in queue, the bill and the client’s history.</p>
            <div className="mk-features">
              {FEATURES.map((f) => (
                <div key={f.title} className="mk-feature">
                  <span className="mk-feature-icon"><Icon name={f.icon} size={20} /></span>
                  <h3>{f.title}</h3>
                  <p>{f.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="mk-section mk-pricing-band" id="pricing">
          <div className="mk-wrap">
            <h2 className="mk-h2">Simple monthly pricing</h2>
            <p className="mk-sub">Pick a plan after your trial. Change or cancel whenever you like.</p>
            <Pricing />
          </div>
        </section>

        <section className="mk-section" id="faq">
          <div className="mk-wrap mk-faq-grid">
            <div>
              <h2 className="mk-h2">Questions salon owners ask</h2>
              <p className="mk-sub">Something else? Write to us on WhatsApp at +91 80 4710 2200 and a person will reply.</p>
            </div>
            <div className="mk-faq">
              {FAQ.map((f) => (
                <details key={f.q}>
                  <summary>{f.q}<Icon name="chevronDown" size={18} /></summary>
                  <p>{f.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        <section className="mk-cta">
          <div className="mk-wrap between mk-cta-inner">
            <div>
              <h2>Try it with your own menu and team.</h2>
              <p>Free for {TRIAL_DAYS} days. We’ll help you connect WhatsApp.</p>
            </div>
            <Link href="/signup" className="btn btn-accent btn-lg">Start free trial</Link>
          </div>
        </section>
      </main>

      <footer className="mk-footer">
        <div className="mk-wrap mk-footer-grid">
          <div className="stack-sm">
            <span className="mk-logo"><span className="brand-mark">S</span>Styile</span>
            <p className="small muted">Salon software made in Bengaluru for salons across India.</p>
          </div>
          <nav className="stack-sm small" aria-label="Product">
            <a href="#features">Features</a>
            <a href="#pricing">Pricing</a>
            <a href="#faq">Questions</a>
          </nav>
          <nav className="stack-sm small" aria-label="Account">
            <Link href="/login">Salon log in</Link>
            <Link href="/signup">Start free trial</Link>
            <Link href="/me">Client bookings</Link>
          </nav>
          <p className="tiny muted mk-footer-legal">© {new Date().getFullYear()} Styile. Prices in INR, GST extra.</p>
        </div>
      </footer>
    </div>
  );
}
