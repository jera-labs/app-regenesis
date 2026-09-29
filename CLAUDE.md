# Neurohackers Monorepo — Re-Génesis + Plataforma

Dos webapps estáticas (HTML+JS vanilla, **sin frameworks ni build**) sobre UN
Postgres compartido (Supabase). Cliente: Frank Ruiz (Neurohackers, programa
terapéutico Re-Génesis de 70 días + plataforma de negocio). Contratista:
Alexander González (`alex@marketingnativo.com`).

## Mapa de módulos (el detalle vive en el CLAUDE.md de cada área)

| Área | Dominio/rol | Qué es |
|---|---|---|
| [plataforma/](plataforma/CLAUDE.md) | plataforma.neurohackers.cloud | App principal: hub cliente + módulos + CRM admin + copia operativa de Re-Génesis (fuente de verdad) |
| [regenesis/](regenesis/CLAUDE.md) | neurohackers.cloud | Sitio viejo de Re-Génesis, LEGACY VIVO en paralelo (no desarrollar aquí) |
| [supabase/](supabase/CLAUDE.md) | migraciones | Postgres compartido: numeración global, huecos documentados, política de aplicación |
| [docs/](docs/) | referentes | [design-system.md](docs/design-system.md) · [deploy-y-entornos.md](docs/deploy-y-entornos.md) · [entrega-proyecto.md](docs/entrega-proyecto.md) |
| [archived/](archived/) | histórico | Código retirado (studio, ghl-brand, infra Cloudways); nada vivo lo referencia |

Proyecto hermano fuera del repo: `../insurance-app` (SaaS de seguros, repo y
agente propios; sus migraciones futuras siguen numerándose aquí, como 79-85).

## Cómo correr / verificar / desplegar

- No hay build: abrir los HTML servidos. Baseline:
  `python tools/check-integridad.py` (referencias + sintaxis JS) debe dar VERDE.
- Deploy de estáticos: skill `deploy-vps`. Edge functions y SQL:
  [docs/deploy-y-entornos.md](docs/deploy-y-entornos.md). Smoke prod con curl
  tras CADA deploy.

## Reglas duras (sin excepción)

1. **Las URLs servidas son el contrato**: no mover/renombrar nada dentro de
   `*/public/` (rutas absolutas + `nav.js` hardcodeado + caché del sidebar).
2. **NUNCA** tocar el esquema de Supabase sin confirmación (datos y cron en
   producción); verificar SIEMPRE el estado real con MCP antes de codear.
3. `service_role` jamás en HTML/JS de cliente; solo `anon` (RLS protege).
   Secretos solo en `.env` (nombres en `.env.example`).
4. Cliente Supabase se llama `db`; `escapeHtml()` para todo dato de usuario;
   comentarios en español, identificadores en inglés.
5. Diseño según [docs/design-system.md](docs/design-system.md): dorado OINL
   mesurado, Geist, sin emojis/gradientes/cursivas; conservar el bloque de
   Compromiso.
6. Fixes de Re-Génesis: primero en `plataforma/public/regenesis/`; el árbol
   viejo solo se parchea si el bug afecta al dominio viejo.
7. Nada se muestra a Frank sin probar end-to-end (consola limpia + mobile
   320px). Si una petición contradice estas reglas: preguntar, actualizar el
   CLAUDE.md del área PRIMERO, luego implementar.

> Contexto de negocio e historia completa: versión 2.2 de este archivo en git
> (43 KB, hasta 2026-06-09) y [docs/entrega-proyecto.md](docs/entrega-proyecto.md).
> Versión 3.0 — 2026-07-06 (reorganización documental; mantiene Claude Code con
> confirmación de Alex).
