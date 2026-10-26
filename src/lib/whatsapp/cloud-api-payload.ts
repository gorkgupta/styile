// Builds WhatsApp Cloud API message payloads (pure, no network) and enforces the API's length limits.

export type OutgoingMessage =
  | { type: 'text'; text: string; previewUrl?: boolean }
  | { type: 'buttons'; text: string; buttons: { id: string; title: string }[]; footer?: string }
  | { type: 'list'; text: string; button: string; sections: { title: string; rows: { id: string; title: string; description?: string }[] }[]; footer?: string }
  | { type: 'template'; name: string; language?: string; bodyParams?: string[]; buttonUrlParam?: string; otpCode?: string };

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

export function toGraphPayload(to: string, m: OutgoingMessage): Record<string, unknown> {
  const base = { messaging_product: 'whatsapp', recipient_type: 'individual', to };
  switch (m.type) {
    case 'text':
      return { ...base, type: 'text', text: { body: clip(m.text, 4096), preview_url: !!m.previewUrl } };
    case 'buttons':
      return {
        ...base, type: 'interactive',
        interactive: {
          type: 'button',
          body: { text: clip(m.text, 1024) },
          ...(m.footer ? { footer: { text: clip(m.footer, 60) } } : {}),
          action: { buttons: m.buttons.slice(0, 3).map((b) => ({ type: 'reply', reply: { id: clip(b.id, 256), title: clip(b.title, 20) } })) },
        },
      };
    case 'list':
      return {
        ...base, type: 'interactive',
        interactive: {
          type: 'list',
          body: { text: clip(m.text, 4096) },
          ...(m.footer ? { footer: { text: clip(m.footer, 60) } } : {}),
          action: {
            button: clip(m.button, 20),
            sections: m.sections.slice(0, 10).map((s) => ({
              title: clip(s.title, 24),
              rows: s.rows.slice(0, 10).map((r) => ({ id: clip(r.id, 200), title: clip(r.title, 24), ...(r.description ? { description: clip(r.description, 72) } : {}) })),
            })),
          },
        },
      };
    case 'template': {
      const components: unknown[] = [];
      if (m.otpCode) {
        components.push({ type: 'body', parameters: [{ type: 'text', text: m.otpCode }] });
        components.push({ type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: m.otpCode }] });
      } else {
        if (m.bodyParams?.length) components.push({ type: 'body', parameters: m.bodyParams.map((t) => ({ type: 'text', text: clip(t, 1024) })) });
        if (m.buttonUrlParam) components.push({ type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: m.buttonUrlParam }] });
      }
      return { ...base, type: 'template', template: { name: m.name, language: { code: m.language ?? 'en' }, components } };
    }
  }
}
