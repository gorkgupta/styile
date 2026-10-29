import type { Metadata, Viewport } from 'next';
import { ToastProvider } from '@/components/ui/ui';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'Styile — salon software', template: '%s · Styile' },
  description: 'Appointments, billing, clients and a WhatsApp booking assistant for salons.',
  applicationName: 'Styile',
  appleWebApp: { capable: true, title: 'Styile', statusBarStyle: 'default' },
};

export const viewport: Viewport = { themeColor: '#0F5257', width: 'device-width', initialScale: 1, viewportFit: 'cover' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-IN">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/* Noto covers Hindi and Nepali (Devanagari) and Bengali; Google serves it by unicode-range, so English pages don't download it. */}
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link href="https://fonts.googleapis.com/css2?family=Onest:wght@400;500;600;700;800&family=Noto+Sans+Devanagari:wght@400;500;600;700&family=Noto+Sans+Bengali:wght@400;500;600;700&display=swap" rel="stylesheet" />
      </head>
      <body>
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
