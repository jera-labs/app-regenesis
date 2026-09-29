-- ============================================================================
-- Migración 36: tabla `productos` para el módulo Marca y Oferta
--
-- Re-Génesis no tocaba productos del cliente (es terapia). El módulo Marca y
-- Oferta de la nueva plataforma necesita que cada cliente registre sus
-- productos/servicios para que la IA los audite y genere contenido por cada uno.
--
-- Diseño:
--   - 1 lead → N productos
--   - RLS: cliente solo ve y edita los suyos
--   - IA escribe `salud_score`, `auditoria_*` cuando el cliente pide auditar
-- ============================================================================

CREATE TABLE IF NOT EXISTS productos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES leads(id) ON DELETE CASCADE,

  -- Datos que el cliente captura
  nombre text NOT NULL,
  tipo text CHECK (tipo IN ('servicio_high_ticket','servicio_medio','servicio_bajo','digital','fisico','membresia','otro')),
  precio numeric(12,2),
  moneda text DEFAULT 'USD',
  descripcion text,
  promesa text,
  icp text,
  entregables text,
  siguiente_escalon text,
  estado text NOT NULL DEFAULT 'activo' CHECK (estado IN ('activo','pausado','archivado','borrador')),

  -- Output de la IA
  salud_score int CHECK (salud_score BETWEEN 0 AND 100),
  auditoria_diagnostico text,
  auditoria_tareas jsonb,
  auditoria_at timestamptz,
  auditoria_modelo text,

  -- Stats agregados (poblamos a medida que existan otras tablas)
  posts_generados int NOT NULL DEFAULT 0,
  ventas_cerradas int NOT NULL DEFAULT 0,
  facturacion_30d numeric(12,2) NOT NULL DEFAULT 0,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS productos_lead_id_idx ON productos(lead_id);
CREATE INDEX IF NOT EXISTS productos_estado_idx ON productos(estado);

-- Trigger updated_at
CREATE OR REPLACE FUNCTION productos_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS productos_touch_updated_at_trg ON productos;
CREATE TRIGGER productos_touch_updated_at_trg
BEFORE UPDATE ON productos
FOR EACH ROW EXECUTE FUNCTION productos_touch_updated_at();

-- ============================================================================
-- RLS
-- ============================================================================
ALTER TABLE productos ENABLE ROW LEVEL SECURITY;

-- Cliente: SELECT/INSERT/UPDATE/DELETE sus propios productos
DROP POLICY IF EXISTS productos_cliente_select ON productos;
CREATE POLICY productos_cliente_select ON productos
  FOR SELECT TO authenticated
  USING (lead_id IN (
    SELECT id FROM leads WHERE email = auth.jwt() ->> 'email'
  ));

DROP POLICY IF EXISTS productos_cliente_insert ON productos;
CREATE POLICY productos_cliente_insert ON productos
  FOR INSERT TO authenticated
  WITH CHECK (lead_id IN (
    SELECT id FROM leads WHERE email = auth.jwt() ->> 'email'
  ));

DROP POLICY IF EXISTS productos_cliente_update ON productos;
CREATE POLICY productos_cliente_update ON productos
  FOR UPDATE TO authenticated
  USING (lead_id IN (
    SELECT id FROM leads WHERE email = auth.jwt() ->> 'email'
  ))
  WITH CHECK (lead_id IN (
    SELECT id FROM leads WHERE email = auth.jwt() ->> 'email'
  ));

DROP POLICY IF EXISTS productos_cliente_delete ON productos;
CREATE POLICY productos_cliente_delete ON productos
  FOR DELETE TO authenticated
  USING (lead_id IN (
    SELECT id FROM leads WHERE email = auth.jwt() ->> 'email'
  ));

-- Admin: ALL
DROP POLICY IF EXISTS productos_admin_all ON productos;
CREATE POLICY productos_admin_all ON productos
  FOR ALL TO authenticated
  USING (auth.jwt() ->> 'email' IN (SELECT email FROM usuarios_admin))
  WITH CHECK (auth.jwt() ->> 'email' IN (SELECT email FROM usuarios_admin));

-- Service role: ALL (para Edge Functions con SUPABASE_SERVICE_ROLE_KEY)
DROP POLICY IF EXISTS productos_service_all ON productos;
CREATE POLICY productos_service_all ON productos
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

COMMENT ON TABLE productos IS 'Productos y servicios que el cliente vende. Unidad atómica del módulo Marca y Oferta. Toda la generación de contenido y tareas se hace por producto, no por marca.';
