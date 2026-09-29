-- ============================================================================
-- loadtest/seed_users.sql
-- Crea 100 usuarios de prueba para k6:
--   loadtest+1..100@neurohackers.test  password: LoadTest2026!
-- Idempotente: si ya existen, no hace nada.
--
-- Marca cada lead con fuente='loadtest' para identificación posterior.
-- NUNCA usar fuera de carga / desarrollo.
-- ============================================================================

DO $$
DECLARE
  i int;
  v_email text;
  v_uid uuid;
  v_lead_id uuid;
BEGIN
  FOR i IN 1..100 LOOP
    v_email := 'loadtest+' || i || '@neurohackers.test';

    -- Auth user (siguiendo patrón safe-auth-user-edit: defaults vacíos para evitar NULL en strings)
    INSERT INTO auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at,
      email_change, email_change_token_new, email_change_token_current,
      email_change_confirm_status, recovery_token, confirmation_token,
      reauthentication_token, phone_change, phone_change_token
    )
    VALUES (
      '00000000-0000-0000-0000-000000000000',
      gen_random_uuid(),
      'authenticated', 'authenticated',
      v_email,
      crypt('LoadTest2026!', gen_salt('bf')),
      now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object('fuente','loadtest','seed_n', i),
      now(), now(),
      '', '', '', 0, '', '', '', '', ''
    )
    ON CONFLICT (email) DO NOTHING
    RETURNING id INTO v_uid;

    -- Si ya existía, recupera el id
    IF v_uid IS NULL THEN
      SELECT id INTO v_uid FROM auth.users WHERE email = v_email;
    END IF;

    -- Lead correspondiente (con estado activo para que pueda escribir reflexiones)
    INSERT INTO leads (
      email, nombre, fuente, estado, modalidad, fecha_pago,
      tema_actual_orden, semana_actual,
      duracion_contractual_dias, fecha_activacion_programa
    )
    VALUES (
      v_email,
      'LoadTest User ' || i,
      'loadtest',
      'activo',
      CASE WHEN i % 2 = 0 THEN 'virtual' ELSE 'presencial' END,
      CURRENT_DATE - (i % 60),
      ((i - 1) % 10) + 1,
      ((i - 1) % 10) + 1,
      70,
      CURRENT_DATE - (i % 60)
    )
    ON CONFLICT (email) DO NOTHING
    RETURNING id INTO v_lead_id;
  END LOOP;

  RAISE NOTICE 'Seed completado: 100 usuarios loadtest+1..100@neurohackers.test creados (idempotente)';
END $$;

-- Verificar
SELECT count(*) AS leads_loadtest FROM leads WHERE fuente = 'loadtest';
SELECT count(*) AS users_loadtest FROM auth.users WHERE email LIKE 'loadtest+%@neurohackers.test';
