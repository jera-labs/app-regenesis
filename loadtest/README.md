# Load testing — Neurohackers Platform

Scripts k6 para validar la plataforma bajo carga simulada antes de escalar de 11 a 500+ clientes.

## Setup

1. **Instalar k6** una vez:
   - macOS: `brew install k6`
   - Windows (choco): `choco install k6`
   - Linux: ver https://k6.io/docs/get-started/installation/

2. **Configurar variables de entorno** antes de correr cualquier script:
   ```bash
   export SUPABASE_URL=https://eqyaddcidkywmedwscpu.supabase.co
   export ANON_KEY=eyJhbG...  # de .env (SUPABASE_ANON_KEY)
   export LT_USER_PREFIX=loadtest  # opcional
   export LT_USER_PASSWORD='LoadTest2026!'  # opcional, default del seed
   ```

   PowerShell:
   ```powershell
   $env:SUPABASE_URL = "https://eqyaddcidkywmedwscpu.supabase.co"
   $env:ANON_KEY = "eyJhbG..."
   ```

3. **Crear usuarios de prueba** (idempotente, sólo una vez):
   ```sh
   # Desde la raíz del repo, con psql o desde dashboard Supabase
   psql "$DATABASE_URL" -f loadtest/seed_users.sql
   ```
   Esto crea 100 leads `loadtest+1..100@neurohackers.test` con password `LoadTest2026!`.
   Para borrar después: `psql -f loadtest/cleanup_users.sql`.

## Cómo correr

```bash
cd loadtest

# Smoke test primero (1 usuario, 30s) — valida que todo está OK
k6 run scripts/01_smoke.js

# Si pasa, escalar gradualmente
k6 run scripts/02_lectura_admin.js
k6 run scripts/03_login_burst.js
k6 run scripts/04_reflexion_diaria.js
k6 run scripts/05_pico_finanzas.js

# Test mixto realista al final
k6 run scripts/06_mixed_realistic.js --summary-export=results/baseline-$(date +%Y%m%d).json
```

## Escenarios

| Script | VUs | Duración | Umbral | Qué prueba |
|---|---|---|---|---|
| `01_smoke.js` | 1 | 30s | 100% éxito | Auth + lectura básica |
| `02_lectura_admin.js` | 20 | 2 min | p95 < 1.5s | `/admin/index.html` queries de listado |
| `03_login_burst.js` | 50 | 30s | p95 < 3s, <2% errores | signInWithPassword bajo presión |
| `04_reflexion_diaria.js` | 30 | 5 min | p95 < 8s (Claude lento) | Envío de reflexión + análisis IA |
| `05_pico_finanzas.js` | 10 | 1 min | p95 < 2s | Página `/admin/finanzas.html` con aggregates |
| `06_mixed_realistic.js` | 50 | 10 min | p95 < 2s, <1% errores | 70% lectura + 20% escritura + 10% admin |

## Después de cada corrida

1. **Comparar p95 vs umbral** en el output de k6.
2. **Revisar logs**: `mcp__claude_ai_Supabase__get_logs service=postgres` por queries lentas.
3. **Revisar advisors**: `mcp__claude_ai_Supabase__get_advisors` por warnings nuevos.
4. **Documentar** en `results/YYYY-MM-DD-NN.md` qué se probó y los números.

## Importante

- **No correr contra el cron** (07:00 ET diario). Coordina con Frank antes de cualquier run prolongado en horario activo.
- **Limpieza post-test**: borrar los leads loadtest+N después con `cleanup_users.sql`.
- **Los results/ están gitignored** porque pueden contener datos sensibles. Solo se guardan localmente.
