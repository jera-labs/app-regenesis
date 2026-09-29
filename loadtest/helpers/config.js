// helpers/config.js — config compartida k6.
// Lee de variables de entorno con fallback a valores seguros.

export const config = {
  SUPABASE_URL: __ENV.SUPABASE_URL || 'https://eqyaddcidkywmedwscpu.supabase.co',
  ANON_KEY: __ENV.ANON_KEY || '',
  USER_PREFIX: __ENV.LT_USER_PREFIX || 'loadtest',
  USER_PASSWORD: __ENV.LT_USER_PASSWORD || 'LoadTest2026!',
  USER_DOMAIN: __ENV.LT_USER_DOMAIN || 'neurohackers.test',
  USER_COUNT: parseInt(__ENV.LT_USER_COUNT || '100', 10),
  ADMIN_EMAIL: __ENV.LT_ADMIN_EMAIL || 'alex@marketingnativo.com',
  ADMIN_PASSWORD: __ENV.LT_ADMIN_PASSWORD || '',
};

if (!config.ANON_KEY) {
  console.warn('⚠️  ANON_KEY no seteado. export ANON_KEY=eyJhbG... antes de correr k6.');
}

// Email para un VU. Si tienes 100 usuarios seed y 50 VUs, se reciclan los primeros 50.
export function emailParaVU(vuId) {
  const n = ((vuId - 1) % config.USER_COUNT) + 1;
  return `${config.USER_PREFIX}+${n}@${config.USER_DOMAIN}`;
}
