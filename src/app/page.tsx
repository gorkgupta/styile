import type { Metadata } from 'next';
import { LandingPage } from '@/components/marketing/landing';

export const metadata: Metadata = {
  title: { absolute: 'Styile — salon software with a WhatsApp booking assistant' },
  description: 'Appointments, walk-in tokens, GST billing, client history and a WhatsApp assistant that books clients for you. Built for Indian salons.',
};

export default function Page() {
  return <LandingPage />;
}
