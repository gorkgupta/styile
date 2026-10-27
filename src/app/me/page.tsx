import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = { title: 'Your bookings' };

// Clients see their bookings on each salon's own site (e.g. glowstudio.styile.com/me), never a combined list.
export default function Page() {
  return (
    <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: '24px max(16px, env(safe-area-inset-right, 0px)) 24px max(16px, env(safe-area-inset-left, 0px))' }}>
      <div className="stack" style={{ maxWidth: 440, textAlign: 'center', alignItems: 'center' }}>
        <h1>Your bookings are on your salon’s page</h1>
        <p className="muted">
          Open the link your salon shared with you, or the bill or booking message they sent on WhatsApp,
          and tap <span className="strong ink2">My bookings</span>. It looks like <span className="strong ink2">yoursalon.styile.com</span>.
        </p>
        <Link className="btn btn-secondary" href="/">Go to Styile home</Link>
      </div>
    </main>
  );
}
