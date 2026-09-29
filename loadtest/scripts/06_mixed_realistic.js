// 06_mixed_realistic.js — 50 VUs con mix realista durante 10 min.
// 70% lectura cliente, 20% escritura cliente, 10% admin lectura.
// Este es el test "smoke completo": si pasa, podemos escalar a 500 clientes.

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend, Rate } from 'k6/metrics';
import { config, emailParaVU } from '../helpers/config.js';
import { login, loginAdmin, authHeaders } from '../helpers/auth.js';

const lecturaT = new Trend('mix_lectura', true);
const escrituraT = new Trend('mix_escritura', true);
const adminT = new Trend('mix_admin', true);
const exitoR = new Rate('mix_exito');

export const options = {
  scenarios: {
    mixto: {
      executor: 'ramping-vus',
      startVUs: 5,
      stages: [
        { duration: '2m', target: 25 },
        { duration: '6m', target: 50 },
        { duration: '2m', target: 0 },
      ],
    },
  },
  thresholds: {
    'http_req_duration': ['p(95)<2000'],
    'http_req_failed': ['rate<0.01'],
    'mix_exito': ['rate>0.99'],
  },
};

export function setup() {
  return { admin: loginAdmin() };
}

export default function ({ admin }) {
  const r = Math.random();

  if (r < 0.10) {
    // 10% ADMIN: lista de leads
    if (!admin) return;
    const res = http.get(
      `${config.SUPABASE_URL}/rest/v1/leads?select=id,email,nombre,estado,fecha_pago&estado=neq.perdido&order=fecha_pago.desc&limit=200`,
      { headers: authHeaders(admin), tags: { name: 'admin_lista' } }
    );
    adminT.add(res.timings.duration);
    exitoR.add(res.status === 200);

  } else {
    // CLIENTE: login + acción
    const email = emailParaVU(__VU);
    const session = login(email, config.USER_PASSWORD);
    if (!session) { exitoR.add(false); return; }
    const h = authHeaders(session);

    if (r < 0.80) {
      // 70% LECTURA: dashboard cliente
      const res = http.get(
        `${config.SUPABASE_URL}/rest/v1/leads?select=*&email=eq.${encodeURIComponent(email)}`,
        { headers: h, tags: { name: 'cliente_dashboard' } }
      );
      lecturaT.add(res.timings.duration);
      exitoR.add(res.status === 200);

      // Sub-query: últimas reflexiones
      const res2 = http.get(
        `${config.SUPABASE_URL}/rest/v1/journaling_respuestas?select=id,created_at,longitud_palabras&order=created_at.desc&limit=10`,
        { headers: h, tags: { name: 'cliente_reflexiones' } }
      );
      exitoR.add(res2.status === 200);

    } else {
      // 20% ESCRITURA: trackEvent
      const res = http.post(
        `${config.SUPABASE_URL}/rest/v1/rpc/track_evento`,
        JSON.stringify({
          p_tipo: 'navegacion',
          p_accion: 'loadtest_simulado',
          p_pagina: '/loadtest',
          p_metadata: { vu: __VU, ts: Date.now() },
        }),
        { headers: h, tags: { name: 'cliente_track' } }
      );
      escrituraT.add(res.timings.duration);
      exitoR.add(res.status === 200);
    }
  }

  sleep(Math.random() * 3 + 1);
}
