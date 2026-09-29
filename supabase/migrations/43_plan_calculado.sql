-- ============================================================================
-- Migración 43: tabla plan_calculado
--
-- Guarda los inputs y outputs de las calculadoras del módulo Herramientas:
--   - Mi Meta (matemática del éxito)
--   - Mi Precio (calculadora de precio)
--   - Mi Competencia (analizador de competidores)
--   - Salud 360 (auditoría del negocio)
--
-- 1 cliente puede tener 1 fila por cada tipo de cálculo (latest snapshot).
-- Si quiere historial, podemos versionar en futuro con tabla aparte.
-- ============================================================================

CREATE TABLE IF NOT EXISTS plan_calculado (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  tipo text NOT NULL CHECK (tipo IN ('mi_meta','mi_precio','mi_competencia','salud_360')),

  -- Inputs que el cliente dio
  inputs jsonb,

  -- Outputs calculados
  outputs jsonb,

  -- Notas opcionales del cliente sobre este cálculo
  notas text,

  calculado_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE (lead_id, tipo)
);

CREATE INDEX IF NOT EXISTS plan_calculado_lead_idx ON plan_calculado(lead_id);

CREATE OR REPLACE FUNCTION plan_calculado_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS plan_calculado_touch_trg ON plan_calculado;
CREATE TRIGGER plan_calculado_touch_trg BEFORE UPDATE ON plan_calculado
  FOR EACH ROW EXECUTE FUNCTION plan_calculado_touch_updated_at();

-- ============================================================================
-- RLS (mismo patrón: admin/moderador/lector según asignación + cliente sus propios)
-- ============================================================================
ALTER TABLE plan_calculado ENABLE ROW LEVEL SECURITY;

-- Cliente: sus propios cálculos
CREATE POLICY pc_cliente_select ON plan_calculado FOR SELECT TO authenticated
  USING (lead_id IN (SELECT id FROM leads WHERE email = auth.jwt() ->> 'email'));

CREATE POLICY pc_cliente_insert ON plan_calculado FOR INSERT TO authenticated
  WITH CHECK (lead_id IN (SELECT id FROM leads WHERE email = auth.jwt() ->> 'email'));

CREATE POLICY pc_cliente_update ON plan_calculado FOR UPDATE TO authenticated
  USING (lead_id IN (SELECT id FROM leads WHERE email = auth.jwt() ->> 'email'))
  WITH CHECK (lead_id IN (SELECT id FROM leads WHERE email = auth.jwt() ->> 'email'));

CREATE POLICY pc_cliente_delete ON plan_calculado FOR DELETE TO authenticated
  USING (lead_id IN (SELECT id FROM leads WHERE email = auth.jwt() ->> 'email'));

-- Admin: ALL
CREATE POLICY pc_admin_all ON plan_calculado FOR ALL TO authenticated
  USING (mi_rol_admin() = 'admin') WITH CHECK (mi_rol_admin() = 'admin');

-- Moderador: SELECT + UPDATE asignados
CREATE POLICY pc_mod_select ON plan_calculado FOR SELECT TO authenticated
  USING (mi_rol_admin() = 'moderador' AND tengo_acceso_a_lead(lead_id));

CREATE POLICY pc_mod_update ON plan_calculado FOR UPDATE TO authenticated
  USING (mi_rol_admin() = 'moderador' AND tengo_acceso_a_lead(lead_id))
  WITH CHECK (mi_rol_admin() = 'moderador' AND tengo_acceso_a_lead(lead_id));

-- Lector: SELECT asignados
CREATE POLICY pc_lector_select ON plan_calculado FOR SELECT TO authenticated
  USING (mi_rol_admin() = 'lector' AND tengo_acceso_a_lead(lead_id));

-- Service role
CREATE POLICY pc_service ON plan_calculado FOR ALL TO service_role USING (true) WITH CHECK (true);

COMMENT ON TABLE plan_calculado IS 'Snapshots de las 4 calculadoras del módulo Herramientas. 1 cliente = 1 fila por tipo (overwrite cada vez que recalculan).';
