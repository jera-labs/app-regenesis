-- ============================================================================
-- Migración 76: Academia — tracking granular de video por cliente
--
-- Responde el requisito central de seguimiento: por cada cliente y lección,
-- saber cuánto vio (% real), dónde quedó (para reanudar), hasta dónde llegó,
-- si la terminó, y DÓNDE abandonó.
--
-- - `academia_progreso`: 1 fila por (lead, lección). `segmentos_vistos` guarda
--   los rangos [inicio,fin] únicos realmente vistos → el pct se calcula de ahí
--   (anti-trampa: arrastrar la barra no cuenta como visto).
-- - `academia_eventos_video`: append-only (play/pause/seek/ended/abandono) con
--   el segundo exacto → permite el "mapa de abandono".
-- - `academia_registrar_progreso(...)`: RPC SECURITY DEFINER. El cliente manda
--   los segmentos nuevos vistos; el servidor los fusiona y recalcula el pct.
--   El cliente NUNCA escribe el pct directo.
--
-- INDEPENDENCIA: aditivo. Depende solo de la migración 75 y de `leads`.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- Progreso por cliente+lección
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS academia_progreso (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  leccion_id uuid NOT NULL REFERENCES academia_lecciones(id) ON DELETE CASCADE,
  curso_id uuid REFERENCES academia_cursos(id) ON DELETE CASCADE,  -- denormalizado para queries
  duracion_total_seg int,
  duracion_visto_seg int NOT NULL DEFAULT 0,
  pct_visto numeric(5,2) NOT NULL DEFAULT 0,
  ultimo_segundo int NOT NULL DEFAULT 0,            -- para "seguir viendo"
  max_segundo_alcanzado int NOT NULL DEFAULT 0,
  segmentos_vistos jsonb NOT NULL DEFAULT '[]'::jsonb,  -- [[ini,fin], ...] ya fusionados
  primer_play_at timestamptz,
  completado_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT academia_progreso_lead_leccion_uq UNIQUE (lead_id, leccion_id)
);

CREATE INDEX IF NOT EXISTS academia_progreso_lead_idx    ON academia_progreso (lead_id);
CREATE INDEX IF NOT EXISTS academia_progreso_leccion_idx ON academia_progreso (leccion_id);
CREATE INDEX IF NOT EXISTS academia_progreso_curso_idx   ON academia_progreso (curso_id);

-- ----------------------------------------------------------------------------
-- Eventos de video (append-only) — el "dónde abandonó"
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS academia_eventos_video (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  leccion_id uuid NOT NULL REFERENCES academia_lecciones(id) ON DELETE CASCADE,
  tipo text NOT NULL,
  segundo int,
  pct numeric(5,2),
  ocurrio_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT academia_eventos_tipo_chk
    CHECK (tipo IN ('play','pause','seek','ended','abandono','resume'))
);

CREATE INDEX IF NOT EXISTS academia_eventos_leccion_idx ON academia_eventos_video (leccion_id, tipo);
CREATE INDEX IF NOT EXISTS academia_eventos_lead_idx    ON academia_eventos_video (lead_id, ocurrio_at);

-- ============================================================================
-- Helpers de fusión de segmentos (intervalos [ini,fin])
-- ============================================================================

-- Fusiona una lista de segmentos solapados en una lista mínima ordenada.
CREATE OR REPLACE FUNCTION _academia_merge_segmentos(p_segs jsonb)
RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  r jsonb := '[]'::jsonb;
  cur_ini numeric := NULL;
  cur_fin numeric := NULL;
  seg record;
BEGIN
  IF p_segs IS NULL OR jsonb_typeof(p_segs) <> 'array' THEN
    RETURN '[]'::jsonb;
  END IF;
  FOR seg IN
    SELECT (e->>0)::numeric AS ini, (e->>1)::numeric AS fin
    FROM jsonb_array_elements(p_segs) e
    WHERE jsonb_typeof(e) = 'array'
      AND (e->>1)::numeric > (e->>0)::numeric
    ORDER BY (e->>0)::numeric
  LOOP
    IF cur_ini IS NULL THEN
      cur_ini := seg.ini; cur_fin := seg.fin;
    ELSIF seg.ini <= cur_fin THEN
      cur_fin := GREATEST(cur_fin, seg.fin);
    ELSE
      r := r || jsonb_build_array(jsonb_build_array(cur_ini, cur_fin));
      cur_ini := seg.ini; cur_fin := seg.fin;
    END IF;
  END LOOP;
  IF cur_ini IS NOT NULL THEN
    r := r || jsonb_build_array(jsonb_build_array(cur_ini, cur_fin));
  END IF;
  RETURN r;
END;
$$;

-- Suma total de segundos cubiertos por una lista de segmentos.
CREATE OR REPLACE FUNCTION _academia_total_segmentos(p_segs jsonb)
RETURNS numeric
LANGUAGE sql IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(SUM((e->>1)::numeric - (e->>0)::numeric), 0)
  FROM jsonb_array_elements(COALESCE(p_segs, '[]'::jsonb)) e
  WHERE jsonb_typeof(e) = 'array';
$$;

-- ============================================================================
-- RPC: registrar progreso (el cliente manda segmentos nuevos; el server fusiona)
-- ============================================================================
CREATE OR REPLACE FUNCTION academia_registrar_progreso(
  p_leccion_id   uuid,
  p_segmentos    jsonb,        -- [[ini,fin], ...] vistos desde el último flush
  p_ultimo_seg   int,          -- posición actual del cursor (para reanudar)
  p_duracion_total int DEFAULT NULL,
  p_completar    boolean DEFAULT false
)
RETURNS academia_progreso
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_lead     uuid;
  v_curso    uuid;
  v_dur      int;
  v_merged   jsonb;
  v_total    numeric;
  v_pct      numeric;
  v_maxseg   numeric;
  v_row      academia_progreso;
BEGIN
  -- Resolver el lead del usuario autenticado (por email del JWT).
  SELECT id INTO v_lead FROM leads WHERE email = auth.jwt() ->> 'email' LIMIT 1;
  IF v_lead IS NULL THEN
    RAISE EXCEPTION 'No autorizado: el usuario no es un lead.';
  END IF;

  -- Curso + duración de catálogo (fallback al param).
  SELECT curso_id, duracion_seg INTO v_curso, v_dur
  FROM academia_lecciones WHERE id = p_leccion_id;
  IF v_curso IS NULL THEN
    RAISE EXCEPTION 'Lección inexistente.';
  END IF;
  v_dur := COALESCE(v_dur, p_duracion_total, 0);

  -- Asegurar fila de progreso.
  INSERT INTO academia_progreso (lead_id, leccion_id, curso_id, duracion_total_seg, primer_play_at)
  VALUES (v_lead, p_leccion_id, v_curso, NULLIF(v_dur, 0), now())
  ON CONFLICT (lead_id, leccion_id) DO NOTHING;

  -- Fusionar segmentos existentes + nuevos.
  SELECT segmentos_vistos INTO v_merged FROM academia_progreso
  WHERE lead_id = v_lead AND leccion_id = p_leccion_id;

  v_merged := _academia_merge_segmentos(
    COALESCE(v_merged, '[]'::jsonb) || COALESCE(p_segmentos, '[]'::jsonb)
  );
  v_total  := _academia_total_segmentos(v_merged);
  v_pct    := CASE WHEN v_dur > 0 THEN LEAST(100, ROUND((v_total / v_dur) * 100, 2)) ELSE 0 END;

  -- max segundo alcanzado a partir de los segmentos.
  SELECT COALESCE(MAX((e->>1)::numeric), 0) INTO v_maxseg
  FROM jsonb_array_elements(v_merged) e;

  UPDATE academia_progreso SET
    segmentos_vistos   = v_merged,
    duracion_visto_seg = FLOOR(v_total),
    duracion_total_seg = COALESCE(duracion_total_seg, NULLIF(v_dur, 0)),
    pct_visto          = v_pct,
    ultimo_segundo     = GREATEST(0, COALESCE(p_ultimo_seg, 0)),
    max_segundo_alcanzado = GREATEST(max_segundo_alcanzado, FLOOR(v_maxseg)),
    completado_at      = CASE
                           WHEN completado_at IS NOT NULL THEN completado_at
                           WHEN p_completar OR v_pct >= 90 THEN now()
                           ELSE NULL
                         END,
    updated_at         = now()
  WHERE lead_id = v_lead AND leccion_id = p_leccion_id
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

COMMENT ON FUNCTION academia_registrar_progreso IS
  'Registra progreso de video: fusiona segmentos vistos server-side y recalcula pct_visto. Umbral de completado = 90%. SECURITY DEFINER: resuelve el lead por el email del JWT.';

-- ============================================================================
-- RLS
-- ============================================================================
ALTER TABLE academia_progreso      ENABLE ROW LEVEL SECURITY;
ALTER TABLE academia_eventos_video ENABLE ROW LEVEL SECURITY;

-- Progreso: el cliente lee SOLO el suyo; admin lee todo. La escritura del pct va
-- por el RPC (SECURITY DEFINER), pero permitimos insert/update propio por si el
-- cliente marca completado manualmente desde el UI.
DROP POLICY IF EXISTS academia_progreso_select ON academia_progreso;
CREATE POLICY academia_progreso_select ON academia_progreso
  FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM leads WHERE id = lead_id AND email = auth.jwt() ->> 'email')
    OR EXISTS (SELECT 1 FROM usuarios_admin WHERE email = auth.jwt() ->> 'email' AND activo = true)
  );

DROP POLICY IF EXISTS academia_progreso_write_own ON academia_progreso;
CREATE POLICY academia_progreso_write_own ON academia_progreso
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM leads WHERE id = lead_id AND email = auth.jwt() ->> 'email'))
  WITH CHECK (EXISTS (SELECT 1 FROM leads WHERE id = lead_id AND email = auth.jwt() ->> 'email'));

DROP POLICY IF EXISTS academia_progreso_admin ON academia_progreso;
CREATE POLICY academia_progreso_admin ON academia_progreso
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM usuarios_admin WHERE email = auth.jwt() ->> 'email' AND activo = true))
  WITH CHECK (EXISTS (SELECT 1 FROM usuarios_admin WHERE email = auth.jwt() ->> 'email' AND activo = true));

DROP POLICY IF EXISTS academia_progreso_service ON academia_progreso;
CREATE POLICY academia_progreso_service ON academia_progreso
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Eventos: cliente inserta/lee los suyos; admin lee todo (para el mapa de abandono).
DROP POLICY IF EXISTS academia_eventos_select ON academia_eventos_video;
CREATE POLICY academia_eventos_select ON academia_eventos_video
  FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM leads WHERE id = lead_id AND email = auth.jwt() ->> 'email')
    OR EXISTS (SELECT 1 FROM usuarios_admin WHERE email = auth.jwt() ->> 'email' AND activo = true)
  );

DROP POLICY IF EXISTS academia_eventos_insert_own ON academia_eventos_video;
CREATE POLICY academia_eventos_insert_own ON academia_eventos_video
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM leads WHERE id = lead_id AND email = auth.jwt() ->> 'email'));

DROP POLICY IF EXISTS academia_eventos_service ON academia_eventos_video;
CREATE POLICY academia_eventos_service ON academia_eventos_video
  FOR ALL TO service_role USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE ON academia_progreso TO authenticated, service_role;
GRANT SELECT, INSERT ON academia_eventos_video TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION academia_registrar_progreso(uuid, jsonb, int, int, boolean) TO authenticated, service_role;

-- Trigger updated_at (reusa la función creada en la migración 75).
DROP TRIGGER IF EXISTS academia_progreso_updated_at ON academia_progreso;
CREATE TRIGGER academia_progreso_updated_at
  BEFORE UPDATE ON academia_progreso
  FOR EACH ROW EXECUTE FUNCTION _academia_set_updated_at();

NOTIFY pgrst, 'reload schema';

COMMIT;
