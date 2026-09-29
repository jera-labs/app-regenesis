-- ============================================================================
-- Migración 67 — Optimización masiva de RLS: envolver auth.jwt() y funciones
-- helper en (SELECT ...) para que Postgres las trate como InitPlan y se
-- evalúen UNA SOLA VEZ por query en vez de por fila.
--
-- Documentado en https://supabase.com/docs/guides/database/postgres/row-level-security#performance
--
-- Resultado: 141 políticas wrappeadas (todas las del schema public que usaban
-- auth.jwt(), mi_rol_admin(), es_admin_activo(), mis_leads_asignados()).
-- Reducción de latencia esperada: 5-20x en queries que tocan tablas con RLS,
-- especialmente las que escanean muchas filas.
-- ============================================================================

DO $$
DECLARE
  r record;
  new_qual text;
  new_check text;
  sql_drop text;
  sql_create text;
  roles_str text;
BEGIN
  FOR r IN
    SELECT schemaname, tablename, policyname, cmd, permissive, roles, qual, with_check
    FROM pg_policies
    WHERE schemaname = 'public'
      AND (qual::text  ~ '(?<!\( ?SELECT )(auth\.jwt|mi_rol_admin|es_admin_activo|mis_leads_asignados)\(\)'
        OR with_check::text ~ '(?<!\( ?SELECT )(auth\.jwt|mi_rol_admin|es_admin_activo|mis_leads_asignados)\(\)')
  LOOP
    new_qual  := r.qual;
    new_check := r.with_check;

    FOR i IN 1..3 LOOP
      IF new_qual IS NOT NULL THEN
        new_qual := regexp_replace(new_qual, '(?<![(]SELECT )auth\.jwt\(\)', '(SELECT auth.jwt())', 'g');
        new_qual := regexp_replace(new_qual, '(?<![(]SELECT )mi_rol_admin\(\)', '(SELECT mi_rol_admin())', 'g');
        new_qual := regexp_replace(new_qual, '(?<![(]SELECT )es_admin_activo\(\)', '(SELECT es_admin_activo())', 'g');
        new_qual := regexp_replace(new_qual, '(?<![(]SELECT )mis_leads_asignados\(\)', '(SELECT mis_leads_asignados())', 'g');
      END IF;
      IF new_check IS NOT NULL THEN
        new_check := regexp_replace(new_check, '(?<![(]SELECT )auth\.jwt\(\)', '(SELECT auth.jwt())', 'g');
        new_check := regexp_replace(new_check, '(?<![(]SELECT )mi_rol_admin\(\)', '(SELECT mi_rol_admin())', 'g');
        new_check := regexp_replace(new_check, '(?<![(]SELECT )es_admin_activo\(\)', '(SELECT es_admin_activo())', 'g');
        new_check := regexp_replace(new_check, '(?<![(]SELECT )mis_leads_asignados\(\)', '(SELECT mis_leads_asignados())', 'g');
      END IF;
    END LOOP;

    IF new_qual IS NOT DISTINCT FROM r.qual AND new_check IS NOT DISTINCT FROM r.with_check THEN
      CONTINUE;
    END IF;

    roles_str := array_to_string(ARRAY(SELECT quote_ident(unnest) FROM unnest(r.roles)), ', ');
    IF roles_str = '' OR roles_str IS NULL THEN roles_str := 'public'; END IF;

    sql_drop := format('DROP POLICY %I ON %I.%I', r.policyname, r.schemaname, r.tablename);
    sql_create := format('CREATE POLICY %I ON %I.%I AS %s FOR %s TO %s',
                        r.policyname, r.schemaname, r.tablename,
                        r.permissive, r.cmd, roles_str);
    IF new_qual IS NOT NULL THEN sql_create := sql_create || format(' USING (%s)', new_qual); END IF;
    IF new_check IS NOT NULL THEN sql_create := sql_create || format(' WITH CHECK (%s)', new_check); END IF;

    EXECUTE sql_drop;
    EXECUTE sql_create;
  END LOOP;
END $$;
