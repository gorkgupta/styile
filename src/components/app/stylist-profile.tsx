'use client';
import { useRef, useState } from 'react';
import { Avatar, Button, Switch, TextArea, useToast } from '@/components/ui/ui';
import { Icon } from '@/components/ui/icons';
import { createClient } from '@/lib/supabase/client';
import { BIO_MAX, cleanSpecialty, SPECIALTIES_MAX, SPECIALTY_MAX_LEN, STAFF_PHOTO_BUCKET, staffPhotoPath } from '@/lib/stylists';

// "Booking page profile" in the team member sheet: what clients see when they choose a stylist online.

export interface StylistProfileValue {
  photoUrl: string | null;
  bio: string;
  specialties: string[];
  years: string;              // as typed; blank = not shown
  showOnBooking: boolean;
}

const MAX_SIDE = 512;

/** Downscale to at most 512px on the long side and re-encode as JPEG (also strips EXIF/location data). */
export async function resizeToJpeg(file: File, maxSide = MAX_SIDE): Promise<Blob> {
  const source = await loadImage(file);
  const scale = Math.min(1, maxSide / Math.max(source.width, source.height));
  const w = Math.max(1, Math.round(source.width * scale));
  const h = Math.max(1, Math.round(source.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Your browser can’t resize photos. Try another browser.');
  ctx.fillStyle = '#fff'; // transparent PNGs get a white background instead of black
  ctx.fillRect(0, 0, w, h);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source.image, 0, 0, w, h);
  source.close();
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Couldn’t read that photo. Try a JPG or PNG.'))), 'image/jpeg', 0.86));
}

async function loadImage(file: File): Promise<{ image: CanvasImageSource; width: number; height: number; close: () => void }> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
      return { image: bmp, width: bmp.width, height: bmp.height, close: () => bmp.close() };
    } catch { /* fall back to <img> (e.g. older Safari) */ }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return { image: img, width: img.naturalWidth, height: img.naturalHeight, close: () => {} };
  } catch {
    URL.revokeObjectURL(url);
    throw new Error('Couldn’t read that photo. Try a JPG or PNG.');
  }
}

/** Uploads to staff-photos/<salon>/<staff>-<time>.jpg (only owners/managers may write there) and returns its public URL. */
export async function uploadStaffPhoto(file: File, salonId: string, staffId: string | null): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('Pick a photo (JPG, PNG or HEIC).');
  if (file.size > 20 * 1024 * 1024) throw new Error('That photo is over 20 MB. Pick a smaller one.');
  const blob = await resizeToJpeg(file);
  const path = `${salonId}/${staffId ?? 'new'}-${Date.now()}.jpg`;
  const bucket = createClient().storage.from(STAFF_PHOTO_BUCKET);
  const { error } = await bucket.upload(path, blob, { upsert: true, contentType: 'image/jpeg', cacheControl: '31536000' });
  if (error) throw new Error('Couldn’t upload the photo. Check your connection and try again.');
  return bucket.getPublicUrl(path).data.publicUrl as string;
}

/** Best-effort clean-up of a replaced photo (the saved profile no longer points at it). */
export async function removeStaffPhoto(url: string | null | undefined) {
  const path = staffPhotoPath(url, process.env.NEXT_PUBLIC_SUPABASE_URL ?? '');
  if (!path) return;
  try { await createClient().storage.from(STAFF_PHOTO_BUCKET).remove([path]); } catch { /* an orphaned file is harmless */ }
}

export function StylistProfileFields({ value, onChange, name, color, salonId, staffId, bookable }: {
  value: StylistProfileValue; onChange: (v: StylistProfileValue) => void;
  name: string; color: string; salonId: string; staffId: string | null; bookable: boolean;
}) {
  const [draft, setDraft] = useState('');
  const [uploading, setUploading] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const toast = useToast();
  const set = (patch: Partial<StylistProfileValue>) => onChange({ ...value, ...patch });
  const first = name.trim().split(' ')[0] || 'them';

  const pickPhoto = async (file: File | undefined) => {
    if (!file) return;
    setPhotoError(null); setUploading(true);
    try {
      set({ photoUrl: await uploadStaffPhoto(file, salonId, staffId) });
      toast('Photo ready. Save to show it to clients.');
    } catch (e) {
      setPhotoError(e instanceof Error ? e.message : 'Couldn’t upload the photo.');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const addSpecialty = () => {
    const s = cleanSpecialty(draft);
    if (!s) return;
    if (value.specialties.some((x) => x.toLowerCase() === s.toLowerCase())) { setDraft(''); return; }
    if (value.specialties.length >= SPECIALTIES_MAX) return;
    set({ specialties: [...value.specialties, s.slice(0, SPECIALTY_MAX_LEN)] });
    setDraft('');
  };

  const full = value.specialties.length >= SPECIALTIES_MAX;
  return (
    <div className="stack">
      <div className="setting-row" style={{ borderTop: 0, paddingTop: 0 }}>
        <div className="grow">
          <div className="strong">Show on booking page</div>
          <div className="small muted">
            {bookable
              ? 'Clients can pick them online and on WhatsApp. Turn off to keep them for front-desk bookings only.'
              : 'Turn on “Takes appointments” first.'}
          </div>
        </div>
        <Switch checked={bookable && value.showOnBooking} disabled={!bookable} onChange={(v) => set({ showOnBooking: v })}
          label={<span className="sr-only">Show on booking page</span>} />
      </div>

      <div className="profile-photo">
        <Avatar name={name || '?'} color={color} photo={value.photoUrl} className="profile-photo-img" />
        <div className="stack-sm" style={{ minWidth: 0 }}>
          <div className="row-wrap" style={{ gap: 8 }}>
            <Button size="sm" icon={value.photoUrl ? 'edit' : 'plus'} loading={uploading} onClick={() => fileRef.current?.click()}>
              {value.photoUrl ? 'Change photo' : 'Add photo'}
            </Button>
            {value.photoUrl && !uploading && <Button size="sm" variant="ghost" onClick={() => set({ photoUrl: null })}>Remove</Button>}
          </div>
          <span className={photoError ? 'error-text' : 'hint'} role={photoError ? 'alert' : undefined}>
            {photoError ?? 'A friendly, well-lit face photo. We resize it for you.'}
          </span>
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => pickPhoto(e.target.files?.[0])} />
        </div>
      </div>

      <TextArea label="Short bio" value={value.bio} onChange={(e) => set({ bio: e.target.value })} maxLength={BIO_MAX} rows={4}
        placeholder={`What clients love about ${first}. E.g. “Soft layers and bobs that grow out beautifully.”`}
        hint={<span className="num">{value.bio.trim().length}/{BIO_MAX}</span>} />

      <div className="field">
        <label htmlFor="staff-specialty">Specialties</label>
        {value.specialties.length > 0 && (
          <ul className="tag-input-list" aria-label="Specialties">
            {value.specialties.map((t) => (
              <li key={t} className="tag-chip">
                {t}
                <button type="button" aria-label={`Remove ${t}`} onClick={() => set({ specialties: value.specialties.filter((x) => x !== t) })}><Icon name="x" size={13} strokeWidth={2.4} /></button>
              </li>
            ))}
          </ul>
        )}
        <div className="row" style={{ gap: 8 }}>
          <input id="staff-specialty" className="input grow" value={draft} maxLength={SPECIALTY_MAX_LEN} disabled={full}
            placeholder={full ? `Up to ${SPECIALTIES_MAX} specialties` : 'E.g. Balayage, Bridal, Curly hair'}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addSpecialty(); } }} />
          <Button icon="plus" onClick={addSpecialty} disabled={full || !draft.trim()}>Add</Button>
        </div>
        <span className="hint">Shown as tags on the booking page and used by the WhatsApp assistant. Up to {SPECIALTIES_MAX}.</span>
      </div>

      <div className="field" style={{ maxWidth: 220 }}>
        <label htmlFor="staff-years">Years of experience</label>
        <div className="suffix-input">
          <input id="staff-years" className="input num" inputMode="numeric" maxLength={2} placeholder="—" value={value.years}
            onChange={(e) => set({ years: e.target.value.replace(/\D/g, '').slice(0, 2) })} />
          <span>years</span>
        </div>
      </div>
    </div>
  );
}
