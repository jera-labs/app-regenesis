-- ============================================================================
-- Migración 39: tabla `contenido_generado`
--
-- Almacena las piezas de contenido que la IA genera para el cliente a partir
-- de un producto + su esencia + su perfil. El cliente las aprueba o las edita.
--
-- Cuando aprueba, eventualmente se programan vía GHL Social Planner.
-- ============================================================================

CREATE TABLE IF NOT EXISTS contenido_generado (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  producto_id uuid REFERENCES productos(id) ON DELETE SET NULL,

  -- Tipo de pieza
  formato text NOT NULL CHECK (formato IN ('post_linkedin','post_instagram','carrusel_ig','reel','story','tweet','email','post_facebook','articulo_blog')),
  canal text CHECK (canal IN ('linkedin','instagram','tiktok','twitter','facebook','email','blog','youtube')),

  -- Contenido
  titulo text,
  hook text,
  cuerpo text NOT NULL,
  cta text,
  hashtags jsonb,

  -- Para reels/carruseles
  slides jsonb,  -- array de {titulo, texto}
  storyboard jsonb,  -- para reels: array de tomas
  duracion_sugerida_seg int,

  -- Estado y workflow
  estado text NOT NULL DEFAULT 'borrador' CHECK (estado IN ('borrador','aprobado','programado','publicado','descartado','editando')),
  programado_para timestamptz,
  publicado_at timestamptz,
  ghl_post_id text, -- id en GHL Social Planner cuando se programe

  -- IA metadata
  generado_at timestamptz NOT NULL DEFAULT now(),
  generado_modelo text,
  generado_tokens_in int,
  generado_tokens_out int,
  generado_costo_usd numeric(8,6),
  generado_prompt_version text,
  contexto_completitud int, -- % de las 4 capas usadas

  -- Stats engagement (futuro)
  engagement_likes int DEFAULT 0,
  engagement_comments int DEFAULT 0,
  engagement_shares int DEFAULT 0,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS contenido_lead_id_idx ON contenido_generado(lead_id);
CREATE INDEX IF NOT EXISTS contenido_producto_id_idx ON contenido_generado(producto_id);
CREATE INDEX IF NOT EXISTS contenido_estado_idx ON contenido_generado(estado);

CREATE OR REPLACE FUNCTION contenido_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS contenido_touch_trg ON contenido_generado;
CREATE TRIGGER contenido_touch_trg BEFORE UPDATE ON contenido_generado
  FOR EACH ROW EXECUTE FUNCTION contenido_touch_updated_at();

-- RLS
ALTER TABLE contenido_generado ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cg_cliente_select ON contenido_generado;
CREATE POLICY cg_cliente_select ON contenido_generado FOR SELECT TO authenticated
  USING (lead_id IN (SELECT id FROM leads WHERE email = auth.jwt() ->> 'email'));

DROP POLICY IF EXISTS cg_cliente_insert ON contenido_generado;
CREATE POLICY cg_cliente_insert ON contenido_generado FOR INSERT TO authenticated
  WITH CHECK (lead_id IN (SELECT id FROM leads WHERE email = auth.jwt() ->> 'email'));

DROP POLICY IF EXISTS cg_cliente_update ON contenido_generado;
CREATE POLICY cg_cliente_update ON contenido_generado FOR UPDATE TO authenticated
  USING (lead_id IN (SELECT id FROM leads WHERE email = auth.jwt() ->> 'email'))
  WITH CHECK (lead_id IN (SELECT id FROM leads WHERE email = auth.jwt() ->> 'email'));

DROP POLICY IF EXISTS cg_cliente_delete ON contenido_generado;
CREATE POLICY cg_cliente_delete ON contenido_generado FOR DELETE TO authenticated
  USING (lead_id IN (SELECT id FROM leads WHERE email = auth.jwt() ->> 'email'));

DROP POLICY IF EXISTS cg_admin_all ON contenido_generado;
CREATE POLICY cg_admin_all ON contenido_generado FOR ALL TO authenticated
  USING (auth.jwt() ->> 'email' IN (SELECT email FROM usuarios_admin))
  WITH CHECK (auth.jwt() ->> 'email' IN (SELECT email FROM usuarios_admin));

DROP POLICY IF EXISTS cg_service_all ON contenido_generado;
CREATE POLICY cg_service_all ON contenido_generado FOR ALL TO service_role USING (true) WITH CHECK (true);

COMMENT ON TABLE contenido_generado IS 'Piezas de contenido generadas por IA a partir de un producto + perfil del cliente. Workflow: borrador → aprobado → programado (via GHL) → publicado.';
