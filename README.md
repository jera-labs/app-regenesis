# Neurohackers Monorepo

Monorepo de Neurohackers (Frank Ruiz): la plataforma de negocio
(`plataforma.neurohackers.cloud`) y el programa terapéutico Re-Génesis de 70
días (`neurohackers.cloud`), sobre un único Postgres en Supabase.

> **Documento maestro:** [CLAUDE.md](CLAUDE.md) (mapa de módulos + reglas
> duras). Cada área tiene su propio CLAUDE.md con el detalle.

## Stack

- **Frontend:** HTML + JavaScript vanilla, sin frameworks ni build.
- **Backend:** Supabase (Postgres + Auth + Edge Functions + Storage), RLS activo.
- **IA:** Anthropic Claude vía edge functions.
- **CRM:** GoHighLevel (source of truth de pagos y contratos).
- **Hosting:** VPS Hostinger administrado con EasyPanel (Docker Swarm, nginx),
  DNS/SSL vía Cloudflare.

## Correr en local

No hay build: servir `plataforma/public/` o `regenesis/public/` con cualquier
estático (p. ej. `python -m http.server`) o abrir los HTML. Credenciales en
`.env` (plantilla: [.env.example](.env.example)).

## Verificar y desplegar

```
python tools/check-integridad.py   # baseline: referencias JS/CSS + sintaxis
```

Deploy de estáticos con la skill `deploy-vps` (pscp + cache-busting + purga
Cloudflare). Pipeline completo y paridad local/servidor:
[docs/deploy-y-entornos.md](docs/deploy-y-entornos.md).

## Estructura

```
plataforma/   app principal (public/ + supabase-functions/ + docs/)
regenesis/    sitio viejo Re-Génesis, legacy vivo (public/ + supabase-functions/)
supabase/     migraciones SQL del Postgres compartido
docs/         design-system, deploy, entrega, material del cliente
archived/     código retirado con contexto
tools/        check-integridad.py
```

El SaaS de seguros (`insurance-app`) vive en su propio repo:
`../insurance-app` (ver su HANDOVER.md).
