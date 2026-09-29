# regenesis/ — Sitio viejo de Re-Génesis (LEGACY VIVO)

Programa terapéutico de 70 días (10 semanas). Este árbol sirve
**https://neurohackers.cloud/** y sigue en producción, pero es la copia
**LEGACY**: la copia operativa más nueva vive en
`plataforma/public/regenesis/` (ver [plataforma/CLAUDE.md](../plataforma/CLAUDE.md)).

> ⚠️ **Regla de oro:** cualquier fix de lógica de Re-Génesis se hace PRIMERO en
> `plataforma/public/regenesis/` (fuente de verdad). Solo se replica aquí si el
> bug afecta al dominio viejo. NO desarrollar features nuevas en este árbol.
>
> **Switch pendiente (decisión de Frank):** redirigir neurohackers.cloud a la
> plataforma y archivar este árbol. Checklist en la memoria
> `project_regenesis_migrado_a_plataforma`. Hasta entonces, ambos conviven.

## Qué hace (para el cliente)

Login → pregunta del día → reflexión libre → análisis IA (Claude vía edge
function `analizar-reflexion`) → diario acumulado → libro al completar 70 días.
Sala de espera ("calentamiento") si paga en día distinto a lunes, numerada por
ISODOW. Onboarding: pago en GHL → `webhook-ghl` → `bienvenida.html` → firma de
contratos (`webhook-firma`) → magic link.

## Archivos

- `public/index.html` + `assets/scripts/client-app.js`: app cliente completa
  (login, dashboard, reflexión, calentamiento). `admin.html` + `admin-app.js`:
  panel admin monolítico. `bienvenida.html`, `libro.html`, `pago.html`,
  `testimonios.html` (redirige a booking GHL), `reunion-resultados.html`.
- `public/assets/styles/`: `tokens.css` (fuente de los design tokens dorado
  OINL, ver [docs/design-system.md](../docs/design-system.md)) + base,
  components, client, admin, platform-sidebar.
- `supabase-functions/`: analizar-reflexion, webhook-ghl (v17), webhook-firma,
  bienvenida-estado, monitor-health, notificar-testimonio,
  procesar-cola-automatizaciones, sync-lead-ghl. Se despliegan por Management
  API multipart (ver skill `ghl-automation` §6 o docs/deploy-y-entornos.md).
- `infra/`: `nginx-new.conf` (referencia de la config live, 2 server blocks) y
  `Dockerfile` (imagen del service Swarm `regenesis`). El nginx REAL del VPS
  vive en el mount de EasyPanel (`files/1.txt`).
- `docs/`: seguridad.md (RLS/hardening), config-ghl.md (workflows GHL paso a
  paso), cliente/ (calendarios Excel), legal/ (contratos).

## Gotchas

- Rutas RELATIVAS (`assets/...`), a diferencia de plataforma (absolutas).
- `pago.html` y `testimonios.html` no tienen enlaces entrantes pero SÍ reciben
  tráfico por URL directa (GHL redirige ahí). No borrar.
- Cache-busting `?v=` distinto al de plataforma (deploys independientes).
- Temas: consultar SIEMPRE por `orden`, nunca por `id` (id ≠ orden). El tema
  semanal sale de la tabla `calendario_temas` (87 lunes), no de un módulo.

## Cómo probar

Abrir `public/index.html` servido (o en prod), login con un lead de prueba,
revisar consola. Verificación de referencias: `python tools/check-integridad.py`
desde la raíz del repo. Smoke prod: `curl -I https://neurohackers.cloud/`.
