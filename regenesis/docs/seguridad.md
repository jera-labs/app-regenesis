# Re-Génesis · Checklist de seguridad

> Auditoría aplicada: 2026-04-29. Mantener actualizado tras cada cambio de policies o nuevas Edge Functions.

## Capa 1 — Base de datos (Supabase)

### RLS (Row Level Security)

✅ **Activo en las 16 tablas de `public`.** Verificado con:
```sql
SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname='public';
```

### Policies por tabla

| Tabla | Cliente | Admin | Service role |
|---|---|---|---|
| `leads` | SELECT solo su propio registro (por email del JWT) | ALL | ALL |
| `journaling_respuestas` | SELECT + INSERT solo de su lead | ALL | — |
| `ia_analisis` | SELECT + INSERT solo de su lead | ALL | — |
| `notificaciones_pendientes` | SELECT solo las suyas | ALL | — |
| `mensajes` | SELECT (todos pueden leer el contenido del programa) | ALL | — |
| `sesiones_calendario` | SELECT (filtrado en frontend por modalidad) | ALL | — |
| `usuarios_admin` | SELECT su propia fila | ALL | — |
| `cron_log` / `webhook_log` | — | SELECT | — |

**Cliente NO puede crear ni modificar leads** (eliminado en migration `16_security_hardening`). Solo el webhook (con service role) o el admin pueden.

### Funciones SECURITY DEFINER

| Función | Quién puede ejecutar | Validación interna |
|---|---|---|
| `es_admin_activo()` | `authenticated` | usa `auth.jwt()` |
| `admin_cron_jobs()` | `authenticated` | rechaza si no está en `usuarios_admin` |
| `ejecutar_cron_diario()` | `authenticated` | rechaza si no está en `usuarios_admin` |
| `procesar_nuevo_cliente()` | servicio interno | llamada solo desde webhook-ghl |
| `cron_diario_completo()` | wrapper interno | llamada solo desde `ejecutar_cron_diario` o pg_cron |

Todas las funciones tienen `search_path = public, pg_temp` fijo (defensa contra search_path hijacking).

`anon` (peticiones sin login) NO puede ejecutar ninguna función SECURITY DEFINER.

## Capa 2 — Edge Functions

### `webhook-ghl`

- `verify_jwt: false` (GHL no tiene JWT)
- Autenticación por `X-Webhook-Secret` (shared secret)
- CORS abierto a `*` (server-to-server, no es desde browser)
- Logs cada evento entrante en `webhook_log`
- Service role solo se usa internamente con `persistSession: false`

### `analizar-reflexion`

- `verify_jwt: true` (requiere JWT autenticado)
- **CORS restringido** a:
  - `https://neurohackers.cloud` (dominio canónico)
  - `https://www.neurohackers.cloud`
  - `https://regenesis.hubnativo.com` (legacy, en transición — retirar cuando todos migren)
  - `http://localhost:5500` (testing)
  - `http://127.0.0.1:5500` (testing)
- `ANTHROPIC_API_KEY` solo en Edge Function secrets, nunca en frontend

## Capa 3 — Frontend

### Headers HTTP (vía `public/.htaccess`)

- `Strict-Transport-Security` — fuerza HTTPS por 1 año
- `X-Content-Type-Options: nosniff` — bloquea XSS via MIME confusion
- `X-Frame-Options: SAMEORIGIN` — bloquea clickjacking
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy` — desactiva camera/mic/geo/payment/USB
- `Content-Security-Policy` — restringe orígenes de scripts, estilos, fonts y conexiones
- Bloqueo de `.env`, `.git`, `.md`, `.sql`, `.bak` y similares
- Listado de directorios deshabilitado

### Frontend code

- `escapeHtml()` aplicado a todo dato del usuario antes de meter al DOM (XSS)
- Queries a Supabase usan query builder (no string concat → no SQL injection)
- `service_role` key NUNCA aparece en frontend, solo `anon` (que es pública por diseño)
- Modal de "Vista admin" cambia textarea a readonly y bloquea submit en modo viewing

## Capa 4 — Auth (Supabase Dashboard)

### TÚ debes configurar manualmente:

| Setting | Recomendación |
|---|---|
| **Site URL** | `https://neurohackers.cloud` |
| **Redirect URLs** | `https://neurohackers.cloud/**`, `https://www.neurohackers.cloud/**`, `https://regenesis.hubnativo.com/**` (durante transición) |
| **Disable signups** | ✅ ON — solo cuentas creadas via webhook (clientes que pagan) o manual (admins) |
| **Email confirmations** | ✅ ON — confirma email antes de activar |
| **Leaked password protection** | ✅ ON — chequea contra HaveIBeenPwned |
| **Min password length** | 8+ caracteres |
| **JWT expiry** | 3600s (1 hora) — default OK, refresh token rota |
| **Rate limiting** | mantener defaults Supabase (suficiente para volumen actual) |

### Lo que falta para producción seria

- [ ] **SMTP custom (Resend)** para evitar rate limit de 4 emails/hora del SMTP gratuito
- [ ] **Captcha** en el login si se vuelve target de bots (Supabase soporta hCaptcha)
- [ ] **MFA / 2FA** para admins (Frank, Tatiana, Santiago) — Supabase soporta TOTP
- [ ] **Logs de actividad admin** — quién editó qué cliente, cuándo
- [ ] **WAF** — Cloudflare proxy ya da capa básica, considerar reglas custom

## Capa 5 — Operacional

### Secrets management

| Secret | Dónde vive | Quién accede |
|---|---|---|
| `SUPABASE_ANON_KEY` | `config.js` (frontend) | Público por diseño, RLS protege |
| `SUPABASE_SERVICE_ROLE_KEY` | `.env` local + Edge Function env | Solo Edge Functions del backend |
| `ANTHROPIC_API_KEY` | Edge Function secret | Solo `analizar-reflexion` |
| `GHL_WEBHOOK_SECRET` | Edge Function secret | Solo `webhook-ghl` valida |
| `GHL_API_KEY` | `.env` local (no se usa aún) | Reservada para futuro callback a GHL |

### Procedimiento ante incidente

1. **Compromiso de cuenta admin:** revocar sesión en Supabase Dashboard → Authentication → Users → buscar email → `Sign out user`. Luego forzar reset de password.
2. **Filtración de service_role key:** rotar en Dashboard → Settings → API → `Reset service_role key`. Luego actualizar `.env` local y secret de Edge Functions.
3. **Filtración de GHL_WEBHOOK_SECRET:** generar uno nuevo, actualizar Supabase Edge Function secret + GHL workflow header.
4. **Compromiso de un lead:** desde admin, cambiar estado a `pausado` para deshabilitar, o cambiar email para forzar nuevo invite.

### Backups

- Supabase tiene backups automáticos diarios incluidos en el plan Pro
- Si estás en plan Free: configurar backup manual semanal exportando con `pg_dump`
- El frontend está en git → recuperación trivial

## Capa 6 — Pendientes conocidos

| Item | Severidad | Acción |
|---|---|---|
| Leaked password protection desactivada | MEDIA | Activar en Dashboard (gratis, 1 click) |
| `pg_net` instalada en schema `public` | BAJA | Best practice, no romper cron por moverla |
| SMTP default con rate limit 4/h | MEDIA | Migrar a Resend cuando entren clientes reales |
| Sin MFA para admins | MEDIA | Activar TOTP cuando esté listo |
| Sin WAF rules custom en Cloudflare | BAJA | Default proxy de Cloudflare ya filtra DDoS común |
| HMAC signature en webhook GHL en lugar de header secret | BAJA | El secret simple sirve para volumen actual |
