// 01_smoke.js — 1 usuario, 30s, validación básica.
// Asegura que el setup (URL, anon key, usuario) funciona antes de scripts pesados.

import http from 'k6/http';
import { check, sleep } from 'k6';
import { config, emailParaVU } from '../helpers/config.js';
import { login, authHeaders } from '../helpers/auth.js';

export const options = {
  vus: 1,
  duration: '30s',
  thresholds: {
    'http_req_failed': ['rate<0.01'],
    'http_req_duration': ['p(95)<2000'],
    'checks': ['rate>0.99'],
  },
};

export default function () {
  const email = emailParaVU(__VU);
  const session = login(email, config.USER_PASSWORD);
  if (!session) return;

  // Lee su propio lead
  const r1 = http.get(
    `${config.SUPABASE_URL}/rest/v1/leads?select=id,email,nombre,estado&email=eq.${encodeURIComponent(email)}`,
    { headers: authHeaders(session), tags: { name: 'leer_mi_lead' } }
  );
  check(r1, { 'mi lead 200': (r) => r.status === 200 });

  sleep(1);
}
