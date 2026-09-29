// 05_pico_finanzas.js — 10 admins abriendo /admin/finanzas.html simultáneamente.
// Mide el path agregado (sum + count en pagos) con índices nuevos.

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend } from 'k6/metrics';
import { config } from '../helpers/config.js';
import { loginAdmin, authHeaders } from '../helpers/auth.js';

const tCash = new Trend('cash_mes_duration', true);
const tCobranza = new Trend('cobranza_lista_duration', true);

export const options = {
  scenarios: {
    pico: {
      executor: 'constant-vus',
      vus: 10,
      duration: '1m',
    },
  },
  thresholds: {
    'http_req_duration{name:cash_mes}': ['p(95)<800'],
    'http_req_duration{name:cobranza_lista}': ['p(95)<1500'],
    'http_req_failed': ['rate<0.01'],
  },
};

export function setup() {
  return { session: loginAdmin() };
}

export default function ({ session }) {
  const h = authHeaders(session);
  const inicio = new Date(); inicio.setDate(1); inicio.setHours(0,0,0,0);
  const inicioISO = inicio.toISOString();

  // 1) Cash del mes (matview de KPIs vivos)
  const r1 = http.post(`${config.SUPABASE_URL}/rest/v1/rpc/admin_kpis_vivos`,
    '{}', { headers: h, tags: { name: 'cash_mes' } });
  check(r1, { 'kpis 200': (r) => r.status === 200 });
  tCash.add(r1.timings.duration);

  // 2) Listado de pagos atrasados (idx_pagos_estado_pagado_at)
  const r2 = http.get(
    `${config.SUPABASE_URL}/rest/v1/pagos?select=id,lead_id,monto_usd,estado,fecha_programada&estado=eq.atrasado&order=fecha_programada.asc&limit=50`,
    { headers: h, tags: { name: 'cobranza_lista' } }
  );
  check(r2, { 'pagos 200': (r) => r.status === 200 });
  tCobranza.add(r2.timings.duration);

  sleep(2);
}
