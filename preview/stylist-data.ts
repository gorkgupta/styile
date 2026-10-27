// Sample stylist profiles for the preview (photos are tiny inline SVG portraits — no external image hosts).
import type { Staff } from '../src/lib/types';
import { staff } from './data';

function portrait(o: { bg1: string; bg2: string; skin: string; neck: string; hair: string; top: string; long?: boolean }) {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 120 120'>
<defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'><stop offset='0' stop-color='${o.bg1}'/><stop offset='1' stop-color='${o.bg2}'/></linearGradient></defs>
<rect width='120' height='120' fill='url(#g)'/>
${o.long ? `<path d='M35 60C30 30 46 17 60 17C76 17 92 29 86 62L92 108L28 108Z' fill='${o.hair}'/>` : ''}
<path d='M20 120C22 97 39 86 60 86C81 86 98 97 100 120Z' fill='${o.top}'/>
<rect x='52' y='68' width='16' height='22' rx='7' fill='${o.neck}'/>
<ellipse cx='60' cy='53' rx='19' ry='23' fill='${o.skin}'/>
<path d='M40 52C37 31 49 25 60 25C73 25 85 31 80 52C77 40 67 35 58 37C50 39 44 44 40 52Z' fill='${o.hair}'/>
</svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg.replace(/\n/g, ''))}`;
}

const profiles: Record<string, Partial<Staff>> = {
  'st-priya': {
    photo_url: portrait({ bg1: '#E9DDF7', bg2: '#C9B3EA', skin: '#C98E6B', neck: '#B27A59', hair: '#2B1B17', top: '#7A3FB8', long: true }),
    years_experience: 9,
    specialties: ['Precision cuts', 'Bobs & layers', 'Curly hair'],
    bio: 'Known for soft layers and bobs that grow out beautifully. Priya will tell you honestly what works for your hair type, and how to style it at home in five minutes.',
  },
  'st-arjun': {
    years_experience: 6,
    specialties: ['Skin fades', 'Beard styling', 'Kids’ cuts'],
    bio: 'Sharp fades and beard shaping. Quick, tidy and great with kids.',
  },
  'st-meera': {
    photo_url: portrait({ bg1: '#FBE3D3', bg2: '#F2BE9C', skin: '#B9785A', neck: '#A3684C', hair: '#3A2219', top: '#C2541B', long: true }),
    years_experience: 12,
    specialties: ['Balayage', 'Global colour', 'Ammonia-free', 'Grey coverage'],
    bio: 'Twelve years of colour, from first-time highlights to full balayage. Meera always does a strand test for sensitive scalps and uses ammonia-free colour on request.',
  },
  'st-sana': {
    years_experience: 4,
    specialties: ['Hydra facials', 'Gel nails'],
  },
};

/** Preview staff with their public profiles filled in. */
export const profiledStaff: Staff[] = staff.map((s) => ({ ...s, ...profiles[s.id] }));

/** Which services each limited stylist does (the rest do everything). */
export const previewSkills: Record<string, string[]> = { 'st-arjun': ['s-cut-m', 's-beard', 's-blow'], 'st-sana': ['s-cleanup', 's-facial', 's-mani', 's-pedi'] };

export const portraitOf = portrait;
