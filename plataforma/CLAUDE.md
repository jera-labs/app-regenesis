# plataforma/ — Neurohackers Platform (app principal)

Sirve **https://plataforma.neurohackers.cloud/** desde `public/` (mount
EasyPanel `html/app/`). HTML + JS vanilla, sin frameworks ni build. Sistema
todo-en-uno: cara cliente (hub "Hoy" + módulos) y cara admin (CRM Bluehackers
completo, fases 1-9 implementadas). Incluye la **copia operativa de Re-Génesis**
(fuente de verdad frente al sitio viejo, ver [../regenesis/CLAUDE.md](../regenesis/CLAUDE.md)).

## Mapa de public/

| Carpeta | Qué es |
|---|---|
| raíz | `index.html` (hub cliente), `login.html`, `mas.html`, `cambiar-password.html` |
| `admin/` | 19 páginas de operación: index (clientes), pipeline (kanban), seguimiento, sesiones, finanzas, comisiones, dashboards, cohortes, catalogos, automatizaciones, tracker-config, configuracion, sistema, equipo, enlaces, cuenta, calendario, cliente (vista 360 impersonada), academia (**no lanzada**) |
| `admin/regenesis/` | Sub-panel de Re-Génesis: inicio, mensajes, testimonios, configuracion, cron (+ `scripts/` propios) |
| `modules/` | Cara cliente: dna, esencia (sin enlace en nav, entrada directa), herramientas, marca-oferta, perfil, tracker, academia (**no lanzada**, migraciones 75-76 sin aplicar) |
| `regenesis/` | Copia operativa del programa 70 días: index, diario, calendario, progreso, libro, bienvenida, pago, reunion (+ assets propios). MÁS NUEVA que el sitio viejo |
| `shared/` | Núcleo compartido: `styles.css`, `nav.js`, `turbo.min.js`, `scripts/` (28 archivos, todos en uso) |
| `live-lucky/`, `regenesis-growth/` | Landings de campaña (CRM Live Lucky y bienvenida Growth) |

## Orden de carga y núcleo intocable

Toda página carga: `config → supabase-client → cache → utils → auth →
event-tracker` + `nav.js` al final; `/admin/*` añade `admin-gate.js`. El resto
de scripts de `shared/scripts/` es un archivo por feature (crm, estados,
pipeline, finanzas, tracker, sesiones, comisiones, dashboards, academia...).
El grafo página→scripts completo está en el informe de auditoría 2026-07-06
(git log de la rama chore/reorg).

## Reglas duras de este árbol

1. **Las URLs son el contrato.** Rutas ABSOLUTAS por todos lados
   (`/shared/...`, `/modules/...`, `/admin/...`): NO mover ni renombrar
   carpetas/páginas servidas. `nav.js` tiene ~40 hrefs absolutos hardcodeados
   y el sidebar se cachea en localStorage (`nav-cache-cliente`/`-admin`).
2. Cliente Supabase SIEMPRE se llama `db`. `escapeHtml()` antes de meter datos
   de usuario al DOM. Vanilla ES6+, sin frameworks (solo `@supabase/supabase-js@2`).
3. Diseño: seguir [docs/design-system.md](../docs/design-system.md) (tokens
   dorado OINL, Geist, sin emojis ni gradientes). Conservar el bloque de
   Compromiso: Frank lo validó como componente clave.
4. Cache-busting `?v=YYYYMMnn` en cada referencia; se re-emite en el deploy
   (skill `deploy-vps`) + purga Cloudflare.
5. Separación cliente/admin: el código de cliente no conoce admin y viceversa;
   comparten solo el núcleo de `shared/`.

## Backend propio

`supabase-functions/`: admin-acceso-cliente, admin-crear-usuario,
auditar-producto, generar-script-venta, intake-submit (**pertenece al producto
insurance-app**, repo aparte; vive aquí porque el Supabase es compartido),
procesar-alertas-cliente, procesar-cola-jobs, sync-ghl-pagos (v14),
sync-ghl-perfil. Migraciones en [../supabase/CLAUDE.md](../supabase/CLAUDE.md).

## docs/ (de este árbol)

Blueprints de automatizaciones GHL (blueprint-automatizaciones-ghl.md es la
fuente de verdad), rediseño de embudos por servicio, correos de recordatorio,
tutoriales Live Lucky, mapa visual (mapa-automatizaciones.html), audit del
journey del cliente.

## Cómo probar

`python tools/check-integridad.py` (raíz del repo) + abrir la página tocada y
revisar consola + mobile 320px. Smoke prod:
`curl -I https://plataforma.neurohackers.cloud/login.html`. Nunca mostrar a
Frank algo no probado end-to-end.
