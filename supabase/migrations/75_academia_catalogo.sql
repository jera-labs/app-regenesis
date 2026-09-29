-- ============================================================================
-- Migración 75: Academia — catálogo de cursos y lecciones + bucket de video
--
-- Módulo "Academia" dentro de la plataforma (reemplaza Skool): cursos con
-- lecciones en video. El video se sirve desde Supabase Storage (bucket privado
-- `academia`) con signed URLs on-demand, igual que el patrón de `testimonios`.
-- El tracking granular de reproducción va en la migración 76.
--
-- INDEPENDENCIA: 100% aditivo. Tablas nuevas, no toca nada existente.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- Catálogo de cursos
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS academia_cursos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  nombre text NOT NULL,
  descripcion text,
  portada_path text,                       -- ruta en el bucket academia (imagen)
  orden int NOT NULL DEFAULT 100,
  visible_cliente boolean NOT NULL DEFAULT true,
  servicio_requerido text,                 -- 'regenesis' | 'terapia' | 'growth' | NULL = todos
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT academia_cursos_servicio_chk
    CHECK (servicio_requerido IS NULL OR servicio_requerido IN ('regenesis','terapia','growth','crm'))
);

CREATE INDEX IF NOT EXISTS academia_cursos_orden_idx ON academia_cursos (orden) WHERE visible_cliente = true;

-- ----------------------------------------------------------------------------
-- Lecciones dentro de un curso
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS academia_lecciones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  curso_id uuid NOT NULL REFERENCES academia_cursos(id) ON DELETE CASCADE,
  slug text NOT NULL,
  nombre text NOT NULL,
  orden int NOT NULL DEFAULT 100,
  video_path text,                         -- ruta del MP4 en el bucket academia
  duracion_seg int,                        -- duración total del video en segundos
  descripcion text,
  recursos_jsonb jsonb NOT NULL DEFAULT '[]'::jsonb,  -- [{label, url}]
  quiz_jsonb jsonb,                        -- opcional: [{pregunta, opciones:[{texto, correcto}]}]
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT academia_lecciones_curso_slug_uq UNIQUE (curso_id, slug)
);

CREATE INDEX IF NOT EXISTS academia_lecciones_curso_idx ON academia_lecciones (curso_id, orden);

-- ----------------------------------------------------------------------------
-- Bucket privado de video
-- ----------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public)
VALUES ('academia', 'academia', false)
ON CONFLICT (id) DO NOTHING;

-- Lectura (necesaria para createSignedUrl): cualquier cliente autenticado puede
-- pedir signed URL de un objeto del bucket. La visibilidad real del curso la
-- controla `academia_cursos.visible_cliente`/`servicio_requerido` + el UI.
DROP POLICY IF EXISTS academia_storage_read ON storage.objects;
CREATE POLICY academia_storage_read ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'academia');

-- Escritura (subir/borrar video): solo admin.
DROP POLICY IF EXISTS academia_storage_admin_write ON storage.objects;
CREATE POLICY academia_storage_admin_write ON storage.objects
  FOR ALL TO authenticated
  USING (bucket_id = 'academia' AND EXISTS (
    SELECT 1 FROM usuarios_admin WHERE email = auth.jwt() ->> 'email' AND activo = true))
  WITH CHECK (bucket_id = 'academia' AND EXISTS (
    SELECT 1 FROM usuarios_admin WHERE email = auth.jwt() ->> 'email' AND activo = true AND rol = 'admin'));

DROP POLICY IF EXISTS academia_storage_service ON storage.objects;
CREATE POLICY academia_storage_service ON storage.objects
  FOR ALL TO service_role
  USING (bucket_id = 'academia') WITH CHECK (bucket_id = 'academia');

-- ============================================================================
-- RLS de las tablas de catálogo
-- ============================================================================
ALTER TABLE academia_cursos    ENABLE ROW LEVEL SECURITY;
ALTER TABLE academia_lecciones ENABLE ROW LEVEL SECURITY;

-- Cursos: cliente autenticado lee los visibles; admin lee/escribe todo.
DROP POLICY IF EXISTS academia_cursos_select ON academia_cursos;
CREATE POLICY academia_cursos_select ON academia_cursos
  FOR SELECT TO authenticated
  USING (
    visible_cliente = true
    OR EXISTS (SELECT 1 FROM usuarios_admin WHERE email = auth.jwt() ->> 'email' AND activo = true)
  );

DROP POLICY IF EXISTS academia_cursos_admin_write ON academia_cursos;
CREATE POLICY academia_cursos_admin_write ON academia_cursos
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM usuarios_admin WHERE email = auth.jwt() ->> 'email' AND activo = true))
  WITH CHECK (EXISTS (SELECT 1 FROM usuarios_admin WHERE email = auth.jwt() ->> 'email' AND activo = true AND rol = 'admin'));

DROP POLICY IF EXISTS academia_cursos_service ON academia_cursos;
CREATE POLICY academia_cursos_service ON academia_cursos
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Lecciones: cliente lee si el curso es visible; admin lee/escribe todo.
DROP POLICY IF EXISTS academia_lecciones_select ON academia_lecciones;
CREATE POLICY academia_lecciones_select ON academia_lecciones
  FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM academia_cursos c WHERE c.id = curso_id AND c.visible_cliente = true)
    OR EXISTS (SELECT 1 FROM usuarios_admin WHERE email = auth.jwt() ->> 'email' AND activo = true)
  );

DROP POLICY IF EXISTS academia_lecciones_admin_write ON academia_lecciones;
CREATE POLICY academia_lecciones_admin_write ON academia_lecciones
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM usuarios_admin WHERE email = auth.jwt() ->> 'email' AND activo = true))
  WITH CHECK (EXISTS (SELECT 1 FROM usuarios_admin WHERE email = auth.jwt() ->> 'email' AND activo = true AND rol = 'admin'));

DROP POLICY IF EXISTS academia_lecciones_service ON academia_lecciones;
CREATE POLICY academia_lecciones_service ON academia_lecciones
  FOR ALL TO service_role USING (true) WITH CHECK (true);

GRANT SELECT ON academia_cursos, academia_lecciones TO authenticated, service_role;
GRANT INSERT, UPDATE, DELETE ON academia_cursos, academia_lecciones TO authenticated, service_role;

-- ============================================================================
-- Trigger updated_at
-- ============================================================================
CREATE OR REPLACE FUNCTION _academia_set_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS academia_cursos_updated_at ON academia_cursos;
CREATE TRIGGER academia_cursos_updated_at
  BEFORE UPDATE ON academia_cursos
  FOR EACH ROW EXECUTE FUNCTION _academia_set_updated_at();

DROP TRIGGER IF EXISTS academia_lecciones_updated_at ON academia_lecciones;
CREATE TRIGGER academia_lecciones_updated_at
  BEFORE UPDATE ON academia_lecciones
  FOR EACH ROW EXECUTE FUNCTION _academia_set_updated_at();

NOTIFY pgrst, 'reload schema';

COMMIT;
