import { NextResponse, type NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { mainUrl, salonUrl } from '@/lib/tenant';

// Short bill link used in WhatsApp templates: https://styile.com/b/<invoice id>.
// One template URL works for every salon; this sends the client to the bill on their salon's own site.
// Reveals nothing but the salon address, and only for a real (unguessable) bill id.
const ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!ID_RE.test(id)) return NextResponse.redirect(mainUrl('/') || '/', 302);
  const { data } = await createAdminClient().from('invoices').select('salon:salons(slug)').eq('id', id).maybeSingle();
  const slug = (data?.salon as { slug?: string } | null)?.slug;
  if (!slug) return NextResponse.redirect(mainUrl('/') || '/', 302);
  return NextResponse.redirect(salonUrl(slug, `/me/bills/${id}`), 302);
}
