// 03_login_burst.js — 50 logins concurrentes en 30s.
// Estresa GoTrue + auth.users. Aprueba si p95<3s y errores<2%.

import { check, sleep } from 'k6';
import { config, emailParaVU } from '../helpers/config.js';
import { login } from '../helpers/auth.js';

export const options = {
  scenarios: {
    burst: {
      executor: 'per-vu-iterations',
      vus: 50,
      iterations: 1,
      maxDuration: '30s',
    },
  },
  thresholds: {
    'http_req_duration{name:login}': ['p(95)<3000'],
    'http_req_failed': ['rate<0.02'],
    'checks': ['rate>0.98'],
  },
};

export default function () {
  const email = emailParaVU(__VU);
  const session = login(email, config.USER_PASSWORD);
  check(session, { 'login OK': (s) => s !== null && !!s.accessToken });
}
