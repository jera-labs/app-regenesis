-- ============================================================================
-- Migración 82: forms (definición de formularios por agente/vertical) — F3
--
-- Aplicada en vivo vía Management API el 2026-06-29.
--
-- El form-builder guarda aquí el schema (secciones/campos + mapeo a custom fields
-- de GHL). El form público /f/<slug> se renderiza desde el form `publicado` del
-- agente. Multi-vertical: cada form tiene su `vertical`.
--   schema jsonb = { secciones: [ { id, titulo, sub?, campos: [
--      { key, label, tipo, required?, opciones?, ghl_field_key?, condicion? } ] } ] }
-- etapa: 'captacion' (Etapa 1) | 'aplicacion' (Etapa 2).
-- ============================================================================

CREATE TABLE IF NOT EXISTS forms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agente_id uuid NOT NULL REFERENCES agentes(id) ON DELETE CASCADE,
  vertical text NOT NULL DEFAULT 'seguros',
  slug_form text NOT NULL DEFAULT 'principal',
  nombre text NOT NULL,
  etapa text NOT NULL DEFAULT 'captacion' CHECK (etapa IN ('captacion','aplicacion')),
  schema jsonb NOT NULL DEFAULT '{"secciones":[]}'::jsonb,
  publicado boolean NOT NULL DEFAULT false,
  version int NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (agente_id, slug_form)
);

CREATE INDEX IF NOT EXISTS forms_agente_idx ON forms(agente_id);

CREATE OR REPLACE FUNCTION forms_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;
DROP TRIGGER IF EXISTS forms_touch_trg ON forms;
CREATE TRIGGER forms_touch_trg BEFORE UPDATE ON forms
FOR EACH ROW EXECUTE FUNCTION forms_touch_updated_at();

-- RLS: agente ve/edita los suyos (mi_agente_id); superadmin todo; service_role todo.
-- El render público lo hace Next server-side con service_role (anon no consulta).
ALTER TABLE forms ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS forms_agente_all ON forms;
CREATE POLICY forms_agente_all ON forms
  FOR ALL TO authenticated
  USING (agente_id = mi_agente_id())
  WITH CHECK (agente_id = mi_agente_id());

DROP POLICY IF EXISTS forms_admin_all ON forms;
CREATE POLICY forms_admin_all ON forms
  FOR ALL TO authenticated
  USING (auth.jwt() ->> 'email' IN (SELECT email FROM usuarios_admin))
  WITH CHECK (auth.jwt() ->> 'email' IN (SELECT email FROM usuarios_admin));

DROP POLICY IF EXISTS forms_service_all ON forms;
CREATE POLICY forms_service_all ON forms
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Seed: un form 'principal' publicado por cada agente de seguros existente,
-- replicando el formulario de captación actual (4 secciones). Ver el INSERT
-- aplicado en vivo (schema jsonb con secciones contacto/tipo/cobertura/consentimiento,
-- campos condicionales de cobertura mapeados a seguro_aseguradora_actual/
-- seguro_vencimiento/seguro_prima_actual).
INSERT INTO forms (agente_id, vertical, slug_form, nombre, etapa, publicado, schema)
SELECT a.id, 'seguros', 'principal', 'Formulario de captación', 'captacion', true,
'{"secciones":[
  {"id":"contacto","titulo":"Tus datos de contacto","sub":"Para que tu asesor pueda comunicarse contigo.","campos":[
    {"key":"nombre","label":"Nombre completo","tipo":"text","required":true},
    {"key":"telefono","label":"Teléfono / WhatsApp","tipo":"tel"},
    {"key":"email","label":"Email","tipo":"email"},
    {"key":"ciudad","label":"Ciudad","tipo":"text"},
    {"key":"codigo_postal","label":"Código postal","tipo":"text"}
  ]},
  {"id":"tipo","titulo":"¿Qué seguro buscas?","sub":"Elige el tipo.","campos":[
    {"key":"tipo_seguro","label":"Tipo de seguro","tipo":"select","required":true,"opciones":["auto","hogar","vida","salud","comercial"]}
  ]},
  {"id":"cobertura","titulo":"Tu cobertura actual","sub":"Si ya tienes un seguro, esto nos ayuda a mejorarlo.","campos":[
    {"key":"tiene_seguro","label":"¿Tienes seguro actualmente?","tipo":"select","opciones":["Sí","No"]},
    {"key":"aseguradora","label":"Aseguradora actual","tipo":"text","ghl_field_key":"seguro_aseguradora_actual","condicion":{"campo":"tiene_seguro","valor":"Sí"}},
    {"key":"vencimiento","label":"Vence","tipo":"text","ghl_field_key":"seguro_vencimiento","condicion":{"campo":"tiene_seguro","valor":"Sí"}},
    {"key":"prima","label":"¿Cuánto pagas hoy? (prima)","tipo":"text","ghl_field_key":"seguro_prima_actual","condicion":{"campo":"tiene_seguro","valor":"Sí"}}
  ]},
  {"id":"consentimiento","titulo":"Casi listo","sub":"Confirma y envía tu solicitud.","campos":[
    {"key":"consentimiento","label":"Autorizo que un asesor me contacte por teléfono, WhatsApp, SMS o email para darme una cotización.","tipo":"checkbox","required":true}
  ]}
]}'::jsonb
FROM agentes a
WHERE a.vertical = 'seguros'
ON CONFLICT (agente_id, slug_form) DO NOTHING;

COMMENT ON TABLE forms IS 'Definición de formularios por agente/vertical (form-builder). El form público se renderiza del form publicado del agente.';

NOTIFY pgrst, 'reload schema';
