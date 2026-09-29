// helpers/auth.js — login para obtener JWT.
// Cada VU mantiene su token; se renueva si expira.

import http from 'k6/http';
import { check, fail } from 'k6';
import { config } from './config.js';

export function login(email, password) {
  const res = http.post(
    `${config.SUPABASE_URL}/auth/v1/token?grant_type=password`,
    JSON.stringify({ email, password }),
    {
      headers: {
        'Content-Type': 'application/json',
        'apikey': config.ANON_KEY,
      },
      tags: { name: 'login' },
    }
  );

  const ok = check(res, {
    'login 200': (r) => r.status === 200,
    'login devuelve access_token': (r) => !!r.json('access_token'),
  });

  if (!ok) {
    console.error(`login fail email=${email} status=${res.status} body=${res.body}`);
    return null;
  }

  return {
    accessToken: res.json('access_token'),
    refreshToken: res.json('refresh_token'),
    expiresIn: res.json('expires_in'),
    userId: res.json('user.id'),
    email,
  };
}

export function authHeaders(session) {
  return {
    'Authorization': `Bearer ${session.accessToken}`,
    'apikey': config.ANON_KEY,
    'Content-Type': 'application/json',
  };
}

// Login del admin global (alex@). Usado en scripts que requieren leer admin data.
export function loginAdmin() {
  if (!config.ADMIN_PASSWORD) {
    fail('LT_ADMIN_PASSWORD no seteado. export LT_ADMIN_PASSWORD=... antes de correr scripts admin.');
  }
  return login(config.ADMIN_EMAIL, config.ADMIN_PASSWORD);
}
