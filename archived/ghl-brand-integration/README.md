# GHL Brand Integration — ARCHIVADO (2026-06-01)

Integración que sincronizaba el DNA del cliente al Brand Panel de GHL y generaba
contenido por producto (`generar-contenido`, módulo `contenido/`, panel de
integraciones). Se retiró junto con Studio en la migración 70
(`70_drop_ghl_brand_integration.sql`): GHL no expone el Brand Board por API
pública (ver memoria `project_ghl_api_limites`) y el Social Planner de GHL ya
cubre la generación/publicación de contenido.

Contenido:
- `contenido-frontend/` — módulo Cola de contenido (antes `modules/contenido/`).
- `generar-contenido-fn/` — edge function de generación de posts/carruseles/reels.
- `integraciones-frontend/` — panel de integraciones GHL.

No reconectar sin revisar primero la estrategia documentada en CLAUDE.md §0 y la
memoria `project_herramientas_estrategia`.
