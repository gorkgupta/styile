import type { MetadataRoute } from 'next';

// Lets salons "install" Styile on a phone or front-desk tablet from the browser.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Styile — salon software',
    short_name: 'Styile',
    start_url: '/app',
    display: 'standalone',
    background_color: '#F6F5F8',
    theme_color: '#0F5257',
    icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
  };
}
