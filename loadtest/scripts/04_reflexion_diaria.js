// 04_reflexion_diaria.js — 30 clientes escribiendo reflexión + análisis IA en 5 min.
// Edge function analizar-reflexion + Claude API. Mide latencia del path lento.
// IMPORTANTE: cada call consume tokens reales de Claude.

import http from 'k6/http';
import { check, sleep } from 'k6';
import { config, emailParaVU } from '../helpers/config.js';
import { login, authHeaders } from '../helpers/auth.js';

const SAMPLE_RESPUESTA = 'Reflexión de prueba bajo carga. ' +
  'Estoy explorando qué se siente este momento de mi vida. ' +
  'Hay miedo y también ganas de cambiar. Me cuesta confiar en el proceso.';

export const options = {
  scenarios: {
    reflexion: {
      executor: 'constant-vus',
      vus: 30,
      duration: '5m',
    },
  },
  thresholds: {
    'http_req_duration{name:analizar}': ['p(95)<8000'],
    'http_req_failed': ['rate<0.02'],
  },
};

export function setup() {
  return { jwt: __ENV.ANON_KEY };
}

export default function () {
  const email = emailParaVU(__VU);
  const session = login(email, config.USER_PASSWORD);
  if (!session) return;
  const h = authHeaders(session);

  // 1) Obtiene su lead actual (para tema/semana)
  const meRes = http.get(
    `${config.SUPABASE_URL}/rest/v1/leads?select=id,tema_actual_orden,semana_actual&email=eq.${encodeURIComponent(email)}`,
    { headers: h, tags: { name: 'mi_lead' } }
  );
  if (meRes.status !== 200) { sleep(1); return; }
  const lead = (meRes.json() || [])[0];
  if (!lead) { sleep(1); return; }

  // 2) Llama a analizar-reflexion (Claude)
  const r = http.post(
    `${config.SUPABASE_URL}/functions/v1/analizar-reflexion`,
    JSON.stringify({
      pregunta: '¿Qué patrón se repite en tu vida cuando no quieres mirar dentro?',
      respuesta: SAMPLE_RESPUESTA,
      tema: lead.tema_actual_orden || 1,
    }),
    { headers: h, tags: { name: 'analizar' }, timeout: '30s' }
  );

  check(r, {
    'analizar 200': (r) => r.status === 200,
    'analizar devuelve análisis': (r) => r.json() && r.json('analisis'),
  });

  // Pausa antes del siguiente VU para no spammear Claude
  sleep(10);
}
