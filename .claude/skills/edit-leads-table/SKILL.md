---
name: edit-leads-table
description: Insert, update, or delete rows in the leads table without violating check constraints, triggers, or FK relations. Use whenever you write SQL that touches `leads` — including creating test users, renaming clients, changing modalidad/cuotas, or backfilling fields.
---

# Editar la tabla `leads` con seguridad

## Constraints duros

| Columna | Valores permitidos | Notas |
|---|---|---|
| `modalidad` | `'presencial'`, `'virtual'` | ❌ No `'pago_unico'`, `'demo'`, etc. |
| `estado` | varios — ver abajo | Ver enum más adelante |
| `email` | UNIQUE | Si insertas duplicado, falla |
| `duracion_contractual_dias` | default 70 (10 sem Re-Génesis) | NO 120 |
| `cuotas_elegidas` | int >= 1 | |

## Estados válidos de `leads.estado`

(Estado terapéutico Re-Génesis, separado del comercial en `lead_estado_comercial`)

- `lead` — capturado pero no ha pagado
- `prospecto_cierre` — en proceso de cierre con closer
- `pagado_calentamiento` — pagó, en sala de espera hasta el lunes
- `activo` — en programa
- `pausa` — pausado
- `caso_exito` — completó con éxito
- `churn` — canceló o renunció
- `perdido` — descartado

## Triggers que pueden bloquear UPDATE

1. **`_leads_enforce_ghl_admin_only`** ([migración 69](supabase/migrations/)) — bloquea UPDATE de `ghl_sub_location_id`, `ghl_sub_location_url`, `ghl_contact_id` si quien actualiza NO es admin activo. Con service role tiene bypass.

2. **Cron `regenesis-diario`** — corre 11:00 UTC cada día, ejecuta `avanzar_lead_diario()` y `procesar_nuevo_cliente()`. Modifica `tema_actual_orden`, `semana_actual`, `estado` automáticamente. NO le pongas valores manualmente que el cron vaya a sobrescribir.

3. **`tg_leads_audit`** (si existe) — registra cambios en `historial_cambios`. Idempotente.

## RLS

Las policies de `leads` para SELECT:
- Lead lee su propio registro (filtra por `auth.jwt() ->> 'email' = email`)
- `admin` rol → ALL
- `moderador` → solo SELECT + UPDATE de leads asignados (`tengo_acceso_a_lead(id)`)
- `lector` → solo SELECT de asignados
- `service_role` → ALL

Cuando edites via MCP de Supabase, vas como `postgres` (bypass RLS). Cuando el navegador edita, va como `authenticated` y aplican policies.

## Patrones seguros

### Crear lead de prueba

```sql
INSERT INTO leads (email, nombre, ghl_contact_id, estado, modalidad, cuotas_elegidas, fecha_pago)
VALUES (
  'cliente+demo@ejemplo.com',
  'Nombre Apellido (DEMO)',
  'demo-test-001',          -- ghl_contact_id ficticio
  'pagado_calentamiento',
  'virtual',                -- presencial o virtual, NADA MÁS
  1,
  CURRENT_DATE
)
ON CONFLICT (email) DO UPDATE SET
  estado = 'pagado_calentamiento',
  contrato_servicio_firmado_at = NULL,
  contrato_waiver_firmado_at = NULL,
  contrato_media_firmado_at = NULL,
  fecha_pago = CURRENT_DATE
RETURNING id, email, ghl_contact_id, estado;
```

### Renombrar email + nombre

Si renombras `leads.email`, **debes** también renombrar `auth.users.email` o el routing post-login se rompe (el lead no aparecerá cuando el usuario entre). Hazlo en transacción o en dos statements seguidos:

```sql
-- Lead
UPDATE leads SET email = 'nuevo@correo.com', nombre = 'Nuevo Nombre'
WHERE lower(email) = 'viejo@correo.com';

-- Auth user (sigue el patrón de safe-auth-user-edit skill)
UPDATE auth.users SET
  email = 'nuevo@correo.com',
  email_confirmed_at = COALESCE(email_confirmed_at, now()),
  email_change = '',
  email_change_token_new = '',
  email_change_token_current = '',
  email_change_confirm_status = 0,
  updated_at = now()
WHERE lower(email) = 'viejo@correo.com';
```

### Activar lead manualmente (forzar a `activo`)

NO recomendado salvo emergencia — el cron debería hacerlo. Si necesitas:

```sql
UPDATE leads SET
  estado = 'activo',
  fecha_activacion_programa = CURRENT_DATE,
  fecha_fin_contractual = CURRENT_DATE + INTERVAL '70 days',
  tema_actual_orden = (SELECT tema_orden FROM calendario_temas WHERE fecha_lunes <= CURRENT_DATE ORDER BY fecha_lunes DESC LIMIT 1)
WHERE id = '<UUID>';
```

### Eliminar lead

Las FKs en `journaling_respuestas`, `ia_analisis`, `pagos`, `lead_asignaciones`, `lead_etiquetas`, `lead_estado_comercial`, `cliente_*`, etc. apuntan a `lead_id`. Algunas tienen `ON DELETE CASCADE` (ej. `cliente_api_keys`), otras no. **Antes de borrar, revisa**:

```sql
-- Ver qué tablas referencian leads.id
SELECT conrelid::regclass, conname, confdeltype
FROM pg_constraint
WHERE confrelid = 'public.leads'::regclass AND contype = 'f';
```

Si hay FK sin CASCADE, primero borra las filas dependientes o las quedarás huérfanas (o el DELETE falla).

Para borrar lead completo + relaciones, usa la función documentada (migración 24):

```sql
SELECT public.eliminar_cliente_completo('<UUID>');
```

## Errores frecuentes

- ❌ `INSERT ... modalidad = 'pago_unico'` → viola check
- ❌ Renombrar `leads.email` sin renombrar `auth.users.email` → cliente no puede entrar
- ❌ Setear `tema_actual_orden = 1` manualmente sin chequear calendario_temas → el cron lo sobrescribe al día siguiente
- ❌ Borrar lead sin verificar FKs → quedan filas huérfanas (notas, pagos, asignaciones)
- ❌ `estado = 'activo'` sin fecha_activacion_programa → reportes financieros rotos
- ❌ Tocar `tema_actual_orden` sin entender [calendario_temas](supabase/migrations/22_calendario_temas.sql) (no es módulo, es lookup en tabla)
