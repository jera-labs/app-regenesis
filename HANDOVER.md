# HANDOVER — Neurohackers Monorepo

> Reorganización y limpieza completadas el 2026-07-06 (rama `chore/reorg`).
> Este documento resume dónde vive cada cosa. Documenta SOLO este monorepo
> (el SaaS de seguros tiene su propio repo y HANDOVER en `../insurance-app`).

## Qué es

Dos webapps estáticas (HTML+JS vanilla, sin build) + un Postgres compartido:

- **plataforma.neurohackers.cloud** ← `plataforma/public/` (app principal:
  hub cliente, módulos, CRM admin completo, copia operativa de Re-Génesis).
- **neurohackers.cloud** ← `regenesis/public/` (sitio viejo de Re-Génesis,
  legacy VIVO en paralelo; los fixes van primero a la copia de plataforma).
- **Supabase** `eqyaddcidkywmedwscpu`: Postgres + Auth + Storage + 18 edge
  functions + cron diario `regenesis-diario`.

## Cómo correr y desplegar

- Local: servir `*/public/` con cualquier estático; credenciales en `.env`
  (plantilla `.env.example`, solo nombres).
- Verificación: skill `verificar-monorepo` (= `python tools/check-integridad.py`
  + smoke curl a las 3 URLs). Debe dar VERDE antes y después de cada cambio.
- Deploy estáticos: skill `deploy-vps` (pscp + `?v=` + purga Cloudflare).
  Password SSH en `.env` (`VPS_SSH_PASSWORD`), ya no está inline en ningún
  archivo. Detalle completo: `docs/deploy-y-entornos.md`.
- SQL: skill `nueva-migracion` (numeración global, huecos documentados).

## Mapa de documentación

| Documento | Contenido |
|---|---|
| `CLAUDE.md` (raíz, ~50 líneas) | Mapa de módulos + reglas duras. Punto de entrada |
| `plataforma/CLAUDE.md` | Módulos, grafo de scripts, reglas del árbol servido |
| `regenesis/CLAUDE.md` | Estado legacy, qué no tocar, switch pendiente (Frank) |
| `supabase/CLAUDE.md` | Política de migraciones, mapa por producto, estado vivo |
| `docs/design-system.md` | Referente ÚNICO de UX (tokens, reglas, accesibilidad) |
| `docs/deploy-y-entornos.md` | Paridad local↔servidor, env vars, pipeline |
| `docs/entrega-proyecto.md` | Entrega histórica detallada (pre-reorg) |
| `plataforma/docs/*.md` | Blueprints de automatizaciones GHL |
| `archived/*/README.md` | Contexto de cada cosa retirada |

Skills del proyecto (`.claude/skills/`, versionadas): `deploy-vps`,
`verificar-monorepo`, `nueva-migracion`, `edit-leads-table`,
`safe-auth-user-edit`, `ghl-automation`, `mobile-css-overrides`.

## Qué cambió en la reorganización (resumen)

1. `insurance-app` (+ el MVP `insurance/`) extraído a repo propio con historia.
2. 79 archivos de producción sin versionar puestos a salvo (commit `30b33c5`).
3. Código muerto fuera (2 `.bak`, `regenesis/tmp/`, `tmp/`, remanente
   `plataforma/public/regenesis/inicio.html`); infra Cloudways archivada.
4. Binarios del cliente fuera de git (siguen en disco); `.gitignore` blindado.
5. CLAUDE.md de 43 KB descompuesto en raíz corto + 3 de área (el viejo queda
   en git history); README reescrito; `.env.example` creado.
6. Password del VPS movida de la skill de deploy a `.env`.

## Pendientes conocidos (decisiones de negocio, no técnicas)

- **Switch del dominio viejo** a la plataforma: requiere OK de Frank
  (checklist en memoria `project_regenesis_migrado_a_plataforma`).
- **Academia**: módulo codificado, migraciones 75-76 SIN aplicar, sin lanzar.
- `regenesis/inicio.html` retirado del repo aún existe en el servidor
  (inofensivo; se limpia en el próximo deploy manual del mount).
- Migraciones futuras del repo insurance-app se numeran en `supabase/migrations/`.
