import Link from 'next/link';

export default function NotFound() {
  return (
    <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24 }}>
      <div className="stack" style={{ textAlign: 'center', alignItems: 'center' }}>
        <h1>This page doesn&apos;t exist</h1>
        <p className="muted">Check the link, or head back to the start.</p>
        <Link className="btn btn-primary" href="/">Go to home page</Link>
      </div>
    </main>
  );
}
