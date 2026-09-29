-- ============================================================================
-- Migración 50: Pipeline configurable + Notas del cliente
--
-- - pipeline_columnas: columnas del kanban editables desde admin. Cada columna
--   tiene un array de estados que la pueblan. Frank puede crear, renombrar,
--   reordenar, desactivar columnas.
-- - cliente_notas: notas operativas rápidas del equipo sobre cada cliente.
--   Append-only, con autor y timestamp. Para registro de llamadas, contexto
--   pre-sesión, alertas internas.
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. pipeline_columnas · columnas del kanban editables
-- ============================================================================
CREATE TABLE IF NOT EXISTS pipeline_columnas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text UNIQUE NOT NULL,
  nombre text NOT NULL,
  descripcion text,
  estados text[] NOT NULL DEFAULT '{}'::text[],
  color text DEFAULT '#86868B',
  icono text,
  orden integer NOT NULL DEFAULT 0,
  activa boolean DEFAULT true,
  visible_mentor boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT pipeline_columnas_slug_format CHECK (slug ~ '^[a-z0-9_-]+$')
);

CREATE INDEX IF NOT EXISTS pipeline_columnas_activa_idx ON pipeline_columnas(activa, orden) WHERE activa = true;

COMMENT ON TABLE pipeline_columnas IS 'Columnas del kanban configurables. estados: array de slugs de estado_comercial que pueblan esta columna.';

-- ============================================================================
-- 2. cliente_notas · bitácora libre de notas operativas
-- ============================================================================
CREATE TABLE IF NOT EXISTS cliente_notas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  autor_id uuid REFERENCES usuarios_admin(id),
  contenido text NOT NULL,
  tipo text DEFAULT 'general',
  pinned boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT cliente_notas_contenido_not_empty CHECK (length(trim(contenido)) > 0),
  CONSTRAINT cliente_notas_tipo_valido CHECK (tipo IN ('general','llamada','alerta','seguimiento','contexto'))
);

CREATE INDEX IF NOT EXISTS cliente_notas_lead_id_idx ON cliente_notas(lead_id, created_at DESC);
CREATE INDEX IF NOT EXISTS cliente_notas_pinned_idx ON cliente_notas(lead_id, pinned) WHERE pinned = true;

COMMENT ON TABLE cliente_notas IS 'Bitácora rápida del equipo sobre cada cliente. Tipos: general, llamada, alerta, seguimiento, contexto.';

-- ============================================================================
-- RLS
-- ============================================================================
ALTER TABLE pipeline_columnas ENABLE ROW LEVEL SECURITY;
ALTER TABLE cliente_notas ENABLE ROW LEVEL SECURITY;

-- pipeline_columnas: lectura para authenticated, escritura admin pleno
DROP POLICY IF EXISTS pc_select ON pipeline_columnas;
CREATE POLICY pc_select ON pipeline_columnas FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS pc_admin ON pipeline_columnas;
CREATE POLICY pc_admin ON pipeline_columnas FOR ALL TO authenticated
  USING (mi_rol_admin() = 'admin') WITH CHECK (mi_rol_admin() = 'admin');

-- cliente_notas: NO visibles al cliente (son internas del equipo)
-- Admin pleno: todas. Moderador/lector: solo de sus asignados.
DROP POLICY IF EXISTS cn_equipo_all ON cliente_notas;
CREATE POLICY cn_equipo_all ON cliente_notas FOR ALL TO authenticated
  USING (
    mi_rol_admin() = 'admin'
    OR (mi_rol_admin() IN ('moderador','lector') AND lead_id IN (SELECT mis_leads_asignados()))
  )
  WITH CHECK (
    mi_rol_admin() = 'admin'
    OR (mi_rol_admin() = 'moderador' AND lead_id IN (SELECT mis_leads_asignados()))
  );

-- ============================================================================
-- Triggers de touch
-- ============================================================================
DROP TRIGGER IF EXISTS pc_touch ON pipeline_columnas;
CREATE TRIGGER pc_touch BEFORE UPDATE ON pipeline_columnas
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

DROP TRIGGER IF EXISTS cn_touch ON cliente_notas;
CREATE TRIGGER cn_touch BEFORE UPDATE ON cliente_notas
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ============================================================================
-- SEED · 5 columnas iniciales (las mismas que ya hardcodeé en estados.js)
-- ============================================================================
INSERT INTO pipeline_columnas (slug, nombre, descripcion, estados, color, orden) VALUES
('onboarding', 'Onboarding', 'Clientes que pagaron y aún no arrancan formal',
  ARRAY['onboarding_pendiente'], '#FBBF24', 10),
('activos', 'Activos', 'En programa, todo en orden',
  ARRAY['activo','extension','renovacion_paga'], '#10B981', 20),
('riesgo', 'En riesgo', 'Cuota impaga, pausa o reembolso pedido',
  ARRAY['activo_cuota_impaga','pausa','reembolso_solicitado'], '#EF4444', 30),
('exito', 'Caso de éxito', 'Cumplieron promesa',
  ARRAY['caso_exito'], '#D4AF37', 40),
('cerrados', 'Cerrados', 'Fuera del programa',
  ARRAY['fin_de_plazo','fin_caso_exito_con_upsell','fin_caso_exito_sin_upsell','reembolso_efectuado','cancela_impago','inactivo'],
  '#6B7280', 50)
ON CONFLICT (slug) DO NOTHING;

COMMIT;
