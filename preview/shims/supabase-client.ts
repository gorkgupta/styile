// Realtime and auth are inert in the preview.
const channel = { on() { return channel; }, subscribe() { return channel; } };
export function createClient() {
  return {
    channel: () => channel,
    removeChannel: () => {},
    auth: {
      signInWithOtp: async () => ({ error: null }),
      verifyOtp: async () => ({ data: { session: {} }, error: null }),
      signOut: async () => ({ error: null }),
    },
  };
}
