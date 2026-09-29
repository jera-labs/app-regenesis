---
name: nueva-migracion
description: Crear y aplicar una migración SQL nueva en el Postgres compartido (Supabase eqyaddcidkywmedwscpu). Usar SIEMPRE que haya que tocar el esquema, crear tablas/funciones/policies o aplicar un fix de datos estructural. Contiene la numeración global, el header obligatorio, el hardening de funciones y la vía de aplicación (Management API).
---

# Nueva migración SQL (Postgres compartido)

## 0. Regla previa

**NUNCA modificar el esquema sin confirmación del usuario** (hay datos de
producción y cron activo). Verificar el estado real con MCP antes de escribir
SQL: `mcp__claude_ai_Supabase__list_tables` / `execute_sql`.

## 1. Numerar

Siguiente número = mayor en `supabase/migrations/` + 1 (numeración GLOBAL del
Postgres, sin importar el producto; incluye las del repo insurance-app).
NO reutilizar los huecos 01-10, 19-21, 32-35, 71-72 (aplicadas sin versionar).

## 2. Escribir el archivo

`supabase/migrations/NN_nombre_snake.sql` con header:

```sql
-- NN_nombre.sql — <propósito en una línea>
-- Proyecto: (Re-Génesis) | (Plataforma) | (Seguros) | (Compartida)
-- Fecha: YYYY-MM-DD · Aplicada vía Management API el YYYY-MM-DD
```

Reglas: constraints nombrados; toda función `SECURITY DEFINER` lleva
`SET search_path = public, pg_temp`; si toca `leads` leer antes la skill
`edit-leads-table`; si toca `auth.users`, la skill `safe-auth-user-edit`.

## 3. Aplicar

Con MCP: `mcp__claude_ai_Supabase__apply_migration` (project_id
`eqyaddcidkywmedwscpu`). Alternativa curl:

```bash
curl -X POST "https://api.supabase.com/v1/projects/eqyaddcidkywmedwscpu/database/query" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d @- <<'EOF'
{"query": "<SQL aquí>"}
EOF
```

## 4. Verificar y cerrar

1. `SELECT` de comprobación sobre lo creado (tabla/función/policy existe y RLS
   queda como se espera: `SELECT * FROM pg_policies WHERE tablename='...'`).
2. Si tocó funciones del cron: revisar `cron_log` en la siguiente corrida.
3. Commit del .sql con mensaje `feat(db): NN <propósito>`.
4. Actualizar `supabase/CLAUDE.md` si cambia el mapa por producto.
