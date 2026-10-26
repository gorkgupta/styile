// Central place to read configuration so a missing value fails with a clear message.
function need(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing environment variable ${name}. See .env.example and docs/DEPLOY.md.`);
  return v;
}

export const env = {
  supabaseUrl: () => need('NEXT_PUBLIC_SUPABASE_URL'),
  supabaseAnonKey: () => need('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
  supabaseServiceKey: () => need('SUPABASE_SERVICE_ROLE_KEY'),
  appUrl: () => (process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000').replace(/\/$/, ''),
  appName: () => process.env.NEXT_PUBLIC_APP_NAME || 'Styile',
  cronSecret: () => need('CRON_SECRET'),
  waAppSecret: () => need('WHATSAPP_APP_SECRET'),
  waVerifyToken: () => need('WHATSAPP_VERIFY_TOKEN'),
  waAccessToken: () => process.env.WHATSAPP_ACCESS_TOKEN || '',
  waGraphVersion: () => process.env.WHATSAPP_GRAPH_VERSION || 'v23.0',
  waPlatformPhoneId: () => process.env.WHATSAPP_PLATFORM_PHONE_NUMBER_ID || '',
  waOtpTemplate: () => process.env.WHATSAPP_OTP_TEMPLATE || 'login_code',
  anthropicKey: () => need('ANTHROPIC_API_KEY'),
  anthropicModel: () => process.env.ANTHROPIC_MODEL || 'claude-haiku-5-5',
  smsHookSecret: () => need('SUPABASE_SMS_HOOK_SECRET'),
};
