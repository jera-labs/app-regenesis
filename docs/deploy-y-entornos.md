# Deploy y entornos — paridad local ↔ servidor

## Topología

| Qué | Local (repo) | Servidor (VPS Hostinger, EasyPanel, Docker Swarm) | Dominio |
|---|---|---|---|
| Sitio viejo Re-Génesis | `regenesis/public/` | `/etc/easypanel/projects/website/regenesis/html/` | neurohackers.cloud |
| Plataforma | `plataforma/public/` | `/etc/easypanel/projects/website/regenesis/html/app/` | plataforma.neurohackers.cloud |
| Edge functions | `*/supabase-functions/` | Supabase (proyecto `eqyaddcidkywmedwscpu`) | — |
| SQL | `supabase/migrations/` | mismo Supabase (aplicar vía Management API) | — |

VPS: `srv1573426.hstgr.cloud` (72.62.96.30), service Swarm `regenesis`
(nginx + estáticos), DNS/SSL vía Cloudflare. **El nginx real está en el mount
de EasyPanel (`files/1.txt`), NO en el repo** (referencia:
`regenesis/infra/nginx-new.conf`). Nunca `docker restart` sobre servicios
Swarm (memoria `project_easypanel_vps_gotchas`).

## Cómo se despliega

- **Estáticos:** skill **`deploy-vps`** (pscp con hostkey pinneado + bump del
  cache-busting `?v=YYYYMMnn` + purga Cloudflare + invalidación del
  localStorage del nav). Verificar SIEMPRE con curl en producción después.
- **Edge functions:** Management API multipart
  (`POST /v1/projects/{ref}/functions/deploy?slug=<fn>`); antes de subir,
  comparar con la versión DESPLEGADA para no pisar fixes (puede ser más nueva
  que el repo). `verify_jwt=false` solo para webhooks GHL.
- **SQL:** ver política en [../supabase/CLAUDE.md](../supabase/CLAUDE.md).

## Variables de entorno (`.env` raíz, gitignored; nombres solamente)

```
SUPABASE_URL / SUPABASE_ANON_KEY            públicas por diseño (RLS protege)
SUPABASE_SERVICE_ROLE_KEY                   privada: solo edge fns y scripts locales
SUPABASE_ACCESS_TOKEN                       Management API (migraciones/deploys)
ANTHROPIC_API_KEY / OPENAI_API_KEY          IA (secrets de edge functions)
GHL_API_KEY / GHL_API_BASE / GHL_API_VERSION / GHL_LOCATION_ID / GHL_COMPANY_ID
GHL_PIT_AGENCY / GHL_WEBHOOK_SECRET / GHL_MCP_URL
VPS_HOST / VPS_SSH_USER / VPS_SSH_PASSWORD  deploy de estáticos
EASYPANEL_URL / EASYPANEL_API_KEY           tRPC de EasyPanel (dominios/services)
CLOUDFLARE                                  purga de caché DNS/CDN
TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID       notificaciones (notificar-testimonio)
CRON_SECRET                                 cron HTTP
CLOUDWAYS_*                                 legacy (hosting viejo, en retirada)
```

Plantilla sin valores: `.env.example`.

## Diferencias local ↔ servidor

- No hay build: lo que está en `public/` es lo que sirve nginx. La única
  transformación del deploy es el token `?v=` (cache-busting).
- **Borrar un archivo del repo NO lo borra del servidor** (el deploy copia,
  no sincroniza con delete). Tras retirar páginas, borrarlas también en el
  mount del VPS o dejarlas morir (inofensivas pero huérfanas). Pendiente
  conocido: `regenesis/inicio.html` retirado del repo el 2026-07-06 sigue en
  el servidor.
- Cloudflare cachea agresivo: sin purga + bump de `?v=`, verás versiones
  viejas aunque el archivo haya subido.

## Verificación (antes y después de todo deploy)

```
python tools/check-integridad.py       # referencias JS/CSS + sintaxis de los .js
curl -I https://neurohackers.cloud/
curl -I https://plataforma.neurohackers.cloud/login.html
curl -I https://plataforma.neurohackers.cloud/regenesis/
```
