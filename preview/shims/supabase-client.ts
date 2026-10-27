// Realtime and auth are inert in the preview.
const channel = { on() { return channel; }, subscribe() { return channel; } };
// Storage: uploads stay in the page as object URLs so photo upload can be tried in the preview.
const files = new Map<string, string>();
const bucket = {
  upload: async (path: string, blob: Blob) => { files.set(path, URL.createObjectURL(blob)); return { data: { path }, error: null }; },
  getPublicUrl: (path: string) => ({ data: { publicUrl: files.get(path) ?? '' } }),
  remove: async () => ({ data: [], error: null }),
};
export function createClient() {
  return {
    channel: () => channel,
    removeChannel: () => {},
    storage: { from: () => bucket },
    auth: {
      signInWithOtp: async () => ({ error: null }),
      verifyOtp: async () => ({ data: { session: {} }, error: null }),
      signOut: async () => ({ error: null }),
    },
  };
}
