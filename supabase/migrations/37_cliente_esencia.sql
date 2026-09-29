-- ============================================================================
-- Migración 37: tabla `cliente_esencia`
--
-- El cliente captura su esencia de marca/persona. Esto alimenta TODA la IA:
-- antes de generar contenido o tareas, la IA lee la esencia + el producto
-- activo. Sin esencia, la IA genera contenido genérico.
--
-- Relación: 1 lead → 1 esencia (única por cliente).
-- ============================================================================

CREATE TABLE IF NOT EXISTS cliente_esencia (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL UNIQUE REFERENCES leads(id) ON DELETE CASCADE,

  -- Quién eres y por qué
  proposito text,
  mision_promesa text,
  historia_personal text,
  diferenciador text,

  -- Valores (array de strings, max 5 sugerido)
  valores jsonb,

  -- Cliente ideal a nivel marca (más amplio que el ICP de un producto)
  icp_marca text,
  problema_principal text,

  -- Voz y estilo
  tono_voz text,
  tono_estilo text CHECK (tono_estilo IN (
    'profesional','cercano','irreverente','didactico','inspiracional','directo','tecnico','reflexivo'
  )),
  palabras_si jsonb,
  palabras_no jsonb,

  -- Inspiración
  referencias text,
  canales_principales jsonb,

  -- Meta IA
  resumen_ia text,
  completitud_score int CHECK (completitud_score BETWEEN 0 AND 100),
  ultima_actualizacion_at timestamptz,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS cliente_esencia_lead_id_idx ON cliente_esencia(lead_id);

-- Trigger updated_at
CREATE OR REPLACE FUNCTION cliente_esencia_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS cliente_esencia_touch_trg ON cliente_esencia;
CREATE TRIGGER cliente_esencia_touch_trg
BEFORE UPDATE ON cliente_esencia
FOR EACH ROW EXECUTE FUNCTION cliente_esencia_touch_updated_at();

-- ============================================================================
-- RLS
-- ============================================================================
ALTER TABLE cliente_esencia ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cliente_esencia_cliente_select ON cliente_esencia;
CREATE POLICY cliente_esencia_cliente_select ON cliente_esencia
  FOR SELECT TO authenticated
  USING (lead_id IN (SELECT id FROM leads WHERE email = auth.jwt() ->> 'email'));

DROP POLICY IF EXISTS cliente_esencia_cliente_insert ON cliente_esencia;
CREATE POLICY cliente_esencia_cliente_insert ON cliente_esencia
  FOR INSERT TO authenticated
  WITH CHECK (lead_id IN (SELECT id FROM leads WHERE email = auth.jwt() ->> 'email'));

DROP POLICY IF EXISTS cliente_esencia_cliente_update ON cliente_esencia;
CREATE POLICY cliente_esencia_cliente_update ON cliente_esencia
  FOR UPDATE TO authenticated
  USING (lead_id IN (SELECT id FROM leads WHERE email = auth.jwt() ->> 'email'))
  WITH CHECK (lead_id IN (SELECT id FROM leads WHERE email = auth.jwt() ->> 'email'));

DROP POLICY IF EXISTS cliente_esencia_admin_all ON cliente_esencia;
CREATE POLICY cliente_esencia_admin_all ON cliente_esencia
  FOR ALL TO authenticated
  USING (auth.jwt() ->> 'email' IN (SELECT email FROM usuarios_admin))
  WITH CHECK (auth.jwt() ->> 'email' IN (SELECT email FROM usuarios_admin));

DROP POLICY IF EXISTS cliente_esencia_service_all ON cliente_esencia;
CREATE POLICY cliente_esencia_service_all ON cliente_esencia
  FOR ALL TO service_role USING (true) WITH CHECK (true);

COMMENT ON TABLE cliente_esencia IS 'Esencia de marca/persona del cliente. 1:1 con leads. Alimenta toda la IA antes que cualquier otro contexto (productos, contenido, tareas).';
