---
name: safe-auth-user-edit
description: Edit auth.users safely without breaking login. Use whenever you reset passwords, change emails, confirm accounts, or otherwise UPDATE auth.users. The Supabase GoTrue driver (Go) rejects NULL on several string columns and crashes login with "Database error querying schema". This skill documents the exact safe patterns.
---

# Editar auth.users sin romper login

## Bug histórico (NUNCA repetir)

El driver Go de Supabase Auth (GoTrue) escanea las filas de `auth.users` con tipos estrictos. **Estas columnas DEBEN ser string vacío (`''`), nunca NULL**. Si pones NULL, el scanner falla con:

```
sql: Scan error on column index N, name "<columna>": converting NULL to string is unsupported
```

Y el usuario NO puede hacer login. El error que ve es: **"Database error querying schema"** (HTTP 500). Se ha causado al menos una vez en producción (2026-06-02) afectando a 11 usuarios activos.

## Columnas peligrosas (DEBE ser `''`, no NULL)

```
email_change
email_change_token_new
email_change_token_current
recovery_token
confirmation_token
reauthentication_token
phone_change
phone_change_token
```

Y estas columnas que esperan un default no-null:
```
email_change_confirm_status  → debe ser 0, no NULL
```

## Columnas que SÍ pueden ser NULL

```
email_confirmed_at     → NULL significa "no confirmado"
last_sign_in_at        → NULL significa "nunca entró"
banned_until           → NULL significa "no baneado"
deleted_at             → NULL significa "activo"
```

## Columnas que NO se actualizan manualmente

```
confirmed_at           → es una columna GENERADA (Postgres lo calcula automáticamente). Setearla da error 428C9.
                          Use email_confirmed_at en su lugar.
```

## Patrón seguro — reset de password

```sql
UPDATE auth.users SET
  encrypted_password = crypt('NuevaPassword123!', gen_salt('bf')),
  updated_at = now()
WHERE lower(email) = lower('cliente@ejemplo.com');
```

NO toques otras columnas si no es necesario.

## Patrón seguro — confirmar email

```sql
UPDATE auth.users SET
  email_confirmed_at = COALESCE(email_confirmed_at, now()),
  -- NO toques confirmed_at (es generated)
  email_change = COALESCE(email_change, ''),
  email_change_token_new = COALESCE(email_change_token_new, ''),
  email_change_token_current = COALESCE(email_change_token_current, ''),
  email_change_confirm_status = COALESCE(email_change_confirm_status, 0),
  updated_at = now()
WHERE lower(email) = lower('cliente@ejemplo.com');
```

## Patrón seguro — cambiar email del usuario

Renombrar el email tiene dos consecuencias:
1. Supabase marca el email nuevo como NO confirmado automáticamente.
2. Si el código maneja mal el cambio, el `email_change` queda como NULL y rompe login.

```sql
UPDATE auth.users SET
  email = 'nuevo@correo.com',
  email_confirmed_at = COALESCE(email_confirmed_at, now()),  -- mantener confirmado
  email_change = '',
  email_change_token_new = '',
  email_change_token_current = '',
  email_change_confirm_status = 0,
  updated_at = now()
WHERE lower(email) = 'viejo@correo.com';
```

**Importante**: si la BD tiene `leads.email` ligado a `auth.users.email` (lo está en este proyecto), actualízalos JUNTOS en una transacción o el routing post-login se rompe.

## Patrón seguro — audit defensivo

Antes de cualquier batch operation sobre auth.users, corre este check para encontrar usuarios rotos:

```sql
SELECT email,
  email_change IS NULL OR
  email_change_token_new IS NULL OR
  email_change_token_current IS NULL OR
  recovery_token IS NULL OR
  confirmation_token IS NULL OR
  reauthentication_token IS NULL OR
  phone_change IS NULL OR
  phone_change_token IS NULL OR
  email_change_confirm_status IS NULL AS tiene_nulls_peligrosos
FROM auth.users
WHERE email_change IS NULL
   OR email_change_token_new IS NULL
   OR recovery_token IS NULL
   OR confirmation_token IS NULL
   OR reauthentication_token IS NULL
   OR phone_change IS NULL
   OR phone_change_token IS NULL
   OR email_change_confirm_status IS NULL;
```

Si retorna filas, ARRÉGLALAS primero con:

```sql
UPDATE auth.users SET
  email_change = COALESCE(email_change, ''),
  email_change_token_new = COALESCE(email_change_token_new, ''),
  email_change_token_current = COALESCE(email_change_token_current, ''),
  recovery_token = COALESCE(recovery_token, ''),
  confirmation_token = COALESCE(confirmation_token, ''),
  reauthentication_token = COALESCE(reauthentication_token, ''),
  phone_change = COALESCE(phone_change, ''),
  phone_change_token = COALESCE(phone_change_token, ''),
  email_change_confirm_status = COALESCE(email_change_confirm_status, 0)
WHERE email_change IS NULL OR email_change_token_new IS NULL
   OR email_change_token_current IS NULL OR recovery_token IS NULL
   OR confirmation_token IS NULL OR reauthentication_token IS NULL
   OR phone_change IS NULL OR phone_change_token IS NULL
   OR email_change_confirm_status IS NULL;
```

## Helper SQL — generar password aleatoria legible

```sql
-- 'Neuro' + 6 caracteres aleatorios + '26!'  → ej. 'NeuroAbcXyz26!'
'Neuro' || substr(translate(encode(gen_random_bytes(6),'base64'), '/+=', 'XYZ'), 1, 6) || '26!'
```

## Diagnóstico — usuario reporta error de login

1. Pide email exacto.
2. Verifica si está en `auth.users` con email confirmado:
   ```sql
   SELECT email, email_confirmed_at IS NOT NULL AS confirmado, last_sign_in_at,
     email_change IS NULL AS roto_email_change,
     recovery_token IS NULL AS roto_recovery
   FROM auth.users WHERE lower(email) = lower('USER@EMAIL');
   ```
3. Revisa logs de auth:
   ```
   mcp__claude_ai_Supabase__get_logs (service: auth)
   → busca "error finding user: sql: Scan error on column ..."
   ```
4. Si hay Scan error → aplica el fix de "audit defensivo".
5. Si email_confirmed_at es NULL → aplica el patrón de "confirmar email".
6. Si nada de eso → el password real es incorrecto, resetéalo.

## Nunca hagas

- ❌ `UPDATE auth.users SET email_change = NULL`
- ❌ Tocar `auth.users.confirmed_at` (generada)
- ❌ Insertar manualmente en `auth.users` (usa Supabase Admin API o RPC)
- ❌ Setear `encrypted_password` sin `crypt(... , gen_salt('bf'))`
- ❌ Cambiar email sin verificar que el nuevo email esté libre en `leads` Y `auth.users`
