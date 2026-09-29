# supabase/ — Postgres compartido (migraciones)

UN solo proyecto Supabase para todo el monorepo: **`Re-Genesis Platform`**
(ref `eqyaddcidkywmedwscpu`, `https://eqyaddcidkywmedwscpu.supabase.co`).
Lo comparten Re-Génesis, la plataforma y el SaaS de seguros (repo aparte
`insurance-app`, ver su HANDOVER).

## Política de migraciones (reglas duras)

1. **Numeración global** `NN_nombre.sql`, correlativa para TODO el Postgres,
   sin importar de qué producto sea. La siguiente libre se deduce de esta
   carpeta (hoy: la 86).
2. Cabecera obligatoria: propósito + a qué proyecto pertenece
   (`-- (Re-Génesis)`, `-- (Plataforma)`, `-- (Seguros)`, `-- (Compartida)`).
3. Toda función `SECURITY DEFINER` lleva `SET search_path = public, pg_temp`
   (hardening desde la migración 16).
4. Se aplican vía Management API (`SUPABASE_ACCESS_TOKEN` del `.env`) o MCP:
   `POST https://api.supabase.com/v1/projects/{ref}/database/query`.
   **NUNCA** cambiar el esquema sin confirmación del usuario: hay datos de
   producción y un cron activo.
5. **Verificar SIEMPRE el estado real con MCP antes de codear** contra la BD;
   este repo se desincroniza (la fuente de verdad es la BD, no los .sql).

## Huecos conocidos en la numeración (NO son errores)

`01-10`, `19-21`, `32-35` y `71-72` se aplicaron vía Management API y nunca se
versionaron. No reutilizar esos números.

## Mapa rápido por producto

- **Re-Génesis:** 14-18 (cron/calentamiento/contratos), 22-23 y 40 (calendario
  de temas), 26-31 (cron sin JWT, timezone NY, personaje/niño interior),
  45, 61 (testimonios), 77-78 (idempotencia onboarding + bloqueo de regresión
  a calentamiento; ver memoria del incidente de cuotas).
- **Plataforma:** 36-39 (productos/esencia/perfil/contenido), 41-44 (roles y
  RLS por asignación), 46-59 (CRM Bluehackers fases 1-9), 62-66 (módulos
  cliente + API keys), 67-70, 73-74 (perf + hardening), 75-76 (Academia,
  **aplicación pendiente**: módulo codificado sin lanzar).
- **Seguros (repo insurance-app):** 79-85. Sus migraciones futuras se numeran
  AQUÍ (mismo Postgres); coordinar con el agente de ese repo.

## Estado vivo (verificar con MCP, no confiar en docs)

- RLS activo en todas las tablas; policies por `auth.jwt() ->> 'email'`.
- Cron diario `regenesis-diario` (`0 11 * * *` UTC) → `ejecutar_cron_diario()`
  con auditoría en `cron_log`. Cálculos en timezone `America/New_York`
  (helper `fecha_hoy()`, migración 27).
- Edge functions: las carpetas locales viven en `regenesis/supabase-functions/`
  y `plataforma/supabase-functions/`; `health-check-periodico` y
  `admin-resetear-password` existen SOLO desplegadas (sin carpeta local).
- Al editar `auth.users` usar la skill `safe-auth-user-edit`; al tocar `leads`,
  la skill `edit-leads-table`.
