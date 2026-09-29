// 02_lectura_admin.js — 20 VUs leyendo lista de leads como admin durante 2 min.
// Mide el hot path de /admin/index.html (índice idx_leads_estado_fecha_pago).

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend } from 'k6/metrics';
import { config } from '../helpers/config.js';
import { loginAdmin, authHeaders } from '../helpers/auth.js';

const trendLista = new Trend('admin_lista_leads_duration', true);

export const options = {
  scenarios: {
    sostenida: {
      executor: 'constant-vus',
      vus: 20,
      duration: '2m',
    },
  },
  thresholds: {
    'http_req_duration{name:lista_leads}': ['p(95)<1500'],
    'http_req_failed': ['rate<0.01'],
  },
};

export function setup() {
  return { session: loginAdmin() };
}

export default function ({ session }) {
  const r = http.get(
    `${config.SUPABASE_URL}/rest/v1/leads?select=id,email,nombre,estado,fecha_pago,modalidad&estado=neq.perdido&order=fecha_pago.desc.nullslast&limit=200`,
    { headers: authHeaders(session), tags: { name: 'lista_leads' } }
  );
  check(r, { 'lista 200': (r) => r.status === 200 });
  trendLista.add(r.timings.duration);

  sleep(1);
}
