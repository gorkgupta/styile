// Mock server actions for the Manage area and the WhatsApp inbox (preview only).
const ok = (message?: string) => ({ ok: true, message });

export const handlers: Record<string, (...args: any[]) => any> = {
  // catalog
  saveCategory: (i: { id?: string; name: string }) => (i.name?.trim() ? { ok: true, data: { id: i.id ?? 'c-new' }, message: i.id ? 'Category renamed' : 'Category added' } : { ok: false, error: 'Enter a category name.' }),
  deleteCategory: () => ok('Category deleted. 2 services are now uncategorised.'),
  saveService: (i: { id?: string; name: string }) => (i.name?.trim() ? { ok: true, data: { id: i.id ?? 's-new' }, message: i.id ? 'Service saved' : 'Service added' } : { ok: false, error: 'Enter the service name.' }),
  updateServicePrice: () => ok('Price updated'),
  archiveService: (_id: string, archived = true) => ok(archived ? 'Service archived. Past bills and appointments are unchanged.' : 'Service restored to the menu'),
  // team
  saveStaff: (i: { id?: string; name: string }) => (i.name?.trim() ? { ok: true, data: { id: i.id ?? 'st-new' }, message: i.id ? `${i.name} saved` : `${i.name} added to the team` } : { ok: false, error: 'Enter their name.' }),
  deactivateStaff: (_id: string, active = false) => (active ? ok('Back on the team') : { ok: false, error: 'They have 2 upcoming appointments. Move or cancel them on the calendar first.' }),
  inviteMember: (i: { email: string }) => (/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(i.email ?? '') ? ok(`Invite sent to ${i.email}`) : { ok: false, error: 'Enter a valid email address.' }),
  changeMemberRole: () => ok('Role changed'),
  removeMember: () => ok('App access removed'),
  // settings
  updateSalonProfile: (i: { gstin?: string }) => (i.gstin && !/^[0-9]{2}[A-Z0-9]{13}$/.test(i.gstin) ? { ok: false, error: 'GSTIN should be 15 characters, like 29ABCDE1234F1Z5. Leave it blank if you aren’t registered.' } : ok('Salon profile saved')),
  updateBilling: () => ok('Billing settings saved'),
  updateBusinessHours: () => ok('Opening hours saved'),
  updateOnlineBooking: () => ok('Online booking settings saved'),
  updateCoinSettings: (i: { enabled: boolean }) => ok(i.enabled ? 'Coin settings saved' : 'Coin sales turned off. Clients can still use the coins they have.'),
  updateAssistant: (i: { botEnabled: boolean }) => ok(i.botEnabled ? 'Assistant settings saved' : 'Assistant turned off. Chats will wait for your team.'),
  // inbox
  replyToConversation: () => ({ ok: true }),
  setBotPaused: (_id: string, paused: boolean) => ok(paused ? 'Assistant paused in this chat. Your team is handling it.' : 'Assistant is replying in this chat again'),
  markRead: () => ({ ok: true }),
};
