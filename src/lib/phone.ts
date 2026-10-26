// Phone numbers are stored as digits with country code ("919876543210"), which is also
// the format WhatsApp uses for wa_id and Supabase uses for phone auth.

export function normalizePhone(input: string, defaultCountry = '91'): string | null {
  const digits = (input || '').replace(/[^0-9]/g, '');
  if (!digits) return null;
  let d = digits.replace(/^00/, '');
  if (d.length === 11 && d.startsWith('0')) d = d.slice(1); // 09876543210
  if (d.length === 10) d = defaultCountry + d;               // 9876543210
  if (d.length < 11 || d.length > 15) return null;
  if (d.startsWith('91') && !/^91[6-9]\d{9}$/.test(d)) return null; // Indian mobiles start 6-9
  return d;
}

/** "+91 98765 43210" */
export function formatPhone(digits: string | null | undefined): string {
  if (!digits) return '';
  if (/^91\d{10}$/.test(digits)) return `+91 ${digits.slice(2, 7)} ${digits.slice(7)}`;
  return `+${digits}`;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}
