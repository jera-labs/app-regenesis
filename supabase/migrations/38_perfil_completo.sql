-- ============================================================================
-- Migración 38: perfil completo del cliente (4 capas)
--
-- Origen: cuestionario onboarding Frank Ruiz (FORMULARIO ON BOARDING REGENESIS.xlsx)
--
-- Diseño:
--   - Capa 1: datos personales/contacto → amplía `leads`
--   - Capa 2: esencia de marca → ya existe en `cliente_esencia`
--   - Capa 3: negocio actual → tabla nueva `cliente_negocio` (datos que la IA
--             usa para generar contenido y priorizar tareas)
--   - Capa 4: diagnóstico profundo / lenguaje Neurohackers → `cliente_diagnostico`
--             (códigos corruptos, miedos, sombra del negocio, conecta con Re-Génesis)
--   - Tracking del avance → `cliente_onboarding` (qué capa completó cada cliente)
--
-- Filosofía: el cliente NO tiene que llenar todo de una. Cada capa es opcional
-- y desbloquea más calidad en lo que la IA hace por él.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Ampliar `leads` con campos de Capa 1 que faltaban
-- ----------------------------------------------------------------------------
ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS documento_identidad text,
  ADD COLUMN IF NOT EXISTS direccion_personal text,
  ADD COLUMN IF NOT EXISTS zona_horaria text,
  ADD COLUMN IF NOT EXISTS persona_confianza text,
  ADD COLUMN IF NOT EXISTS instagram_handle text,
  ADD COLUMN IF NOT EXISTS pais_nacimiento text;

-- ----------------------------------------------------------------------------
-- cliente_negocio (CAPA 3)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cliente_negocio (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL UNIQUE REFERENCES leads(id) ON DELETE CASCADE,

  -- Modelo de negocio
  modelo_negocio text,
  nombre_negocio text,
  anos_experiencia int CHECK (anos_experiencia BETWEEN 0 AND 80),
  tipo_entidad text,
  sitio_web text,
  redes_sociales jsonb,

  -- Finanzas (lo que la IA necesita para entender en qué fase está)
  ingreso_ultimo_mes_usd numeric(12,2),
  ingreso_promedio_3m_usd numeric(12,2),
  ingreso_12m_usd numeric(12,2),
  meta_facturacion_6m_usd numeric(12,2),
  valor_promedio_compra_usd numeric(12,2),
  ltv_cliente_usd numeric(12,2),
  cac_costo_adquisicion_usd numeric(12,2),
  deuda_actual_usd numeric(12,2),

  -- Operación
  modelo_pricing text CHECK (modelo_pricing IN (
    'uno_a_uno','grupo','info_producto','hecho_para_ti','membresia','mixto','otro'
  )),
  horas_trabajo_semana int CHECK (horas_trabajo_semana BETWEEN 0 AND 168),
  pct_tiempo_marketing_ventas int CHECK (pct_tiempo_marketing_ventas BETWEEN 0 AND 100),
  pct_tiempo_servicio int CHECK (pct_tiempo_servicio BETWEEN 0 AND 100),
  pct_tiempo_operaciones int CHECK (pct_tiempo_operaciones BETWEEN 0 AND 100),
  pct_tiempo_estrategia int CHECK (pct_tiempo_estrategia BETWEEN 0 AND 100),

  -- Tracción
  clientes_activos int,
  conversion_estimada_pct int CHECK (conversion_estimada_pct BETWEEN 0 AND 100),
  prospectos_mes int,

  -- Equipo
  equipo_size int,
  proxima_contratacion text,

  -- Sistemas
  herramienta_gestion text,
  usa_crm boolean DEFAULT false,
  nombre_crm text,
  canales_trafico_activos jsonb,

  -- Competencia y diferenciación (CRÍTICO para IA de contenido)
  competidores_principales jsonb,
  ventaja_injusta text,

  -- Pruebas sociales
  tiene_casos_exito boolean DEFAULT false,
  tiene_testimonios_recolectados boolean DEFAULT false,

  -- Estrategia y dolor
  objetivos_principales jsonb,
  problemas_principales text,
  mayor_oportunidad_no_explotada text,
  intentos_si_funcionaron text,
  intentos_no_funcionaron text,
  formaciones_previas text,
  decisiones_un_nuevo_ceo text,

  -- Meta IA
  completitud_score int CHECK (completitud_score BETWEEN 0 AND 100),
  ultima_actualizacion_at timestamptz,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS cliente_negocio_lead_id_idx ON cliente_negocio(lead_id);

-- ----------------------------------------------------------------------------
-- cliente_diagnostico (CAPA 4 — lenguaje Neurohackers + Re-Génesis)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cliente_diagnostico (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL UNIQUE REFERENCES leads(id) ON DELETE CASCADE,

  -- Cómo se ve y se siente
  como_se_describe text,
  referentes_admira text,
  familia_cercana text,
  como_se_siente_hoy text,
  como_quiere_sentirse text,
  como_le_gusta_que_lo_coacheen text,
  como_toma_decisiones text,
  ama_en_un_programa text,
  odia_en_un_programa text,

  -- Decisión de pago (camino a Re-Génesis)
  como_descubrio_neurohackers text,
  hablo_antes_de_pagar_con text,
  investigaciones_previas text,
  tiempo_decision_pago text,
  resistencia_antes_de_pagar text,
  epifania_por_que_pago text,
  por_que_eligio_neurohackers text,
  esperaba_que_incluyera text,

  -- Códigos corruptos / Neurohackers
  codigos_corruptos_actuales text,
  miedo_principal_al_escalar text,
  techo_financiero_trauma text,
  protocolos_soberania_actuales text,

  -- Por qué (visión profunda)
  vision_negocio text,
  el_por_que text,
  una_cosa_si_exito text,
  tres_objetivos_proximos jsonb,
  por_que_quieres_esto text,
  objetivos_personales_negocio text,

  -- Operación interna
  prioriza_filtros_proyectos boolean,
  objetivos_trimestre_atados_a_plan boolean,
  revisa_semanal_que_delegar boolean,
  trabaja_productividad_equipo boolean,
  tiene_agenda_reuniones boolean,

  -- Meta IA
  completitud_score int CHECK (completitud_score BETWEEN 0 AND 100),
  ultima_actualizacion_at timestamptz,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS cliente_diagnostico_lead_id_idx ON cliente_diagnostico(lead_id);

-- ----------------------------------------------------------------------------
-- cliente_onboarding (tracking)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cliente_onboarding (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL UNIQUE REFERENCES leads(id) ON DELETE CASCADE,

  capa_1_completada_at timestamptz,
  capa_2_completada_at timestamptz,
  capa_3_completada_at timestamptz,
  capa_4_completada_at timestamptz,

  score_capa_1 int DEFAULT 0 CHECK (score_capa_1 BETWEEN 0 AND 100),
  score_capa_2 int DEFAULT 0 CHECK (score_capa_2 BETWEEN 0 AND 100),
  score_capa_3 int DEFAULT 0 CHECK (score_capa_3 BETWEEN 0 AND 100),
  score_capa_4 int DEFAULT 0 CHECK (score_capa_4 BETWEEN 0 AND 100),

  score_global int GENERATED ALWAYS AS (
    (COALESCE(score_capa_1,0) + COALESCE(score_capa_2,0) +
     COALESCE(score_capa_3,0) + COALESCE(score_capa_4,0)) / 4
  ) STORED,

  siguiente_paso_sugerido text,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS cliente_onboarding_lead_id_idx ON cliente_onboarding(lead_id);

-- ----------------------------------------------------------------------------
-- Triggers updated_at
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION cliente_negocio_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS cliente_negocio_touch_trg ON cliente_negocio;
CREATE TRIGGER cliente_negocio_touch_trg BEFORE UPDATE ON cliente_negocio
  FOR EACH ROW EXECUTE FUNCTION cliente_negocio_touch_updated_at();

CREATE OR REPLACE FUNCTION cliente_diagnostico_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS cliente_diagnostico_touch_trg ON cliente_diagnostico;
CREATE TRIGGER cliente_diagnostico_touch_trg BEFORE UPDATE ON cliente_diagnostico
  FOR EACH ROW EXECUTE FUNCTION cliente_diagnostico_touch_updated_at();

CREATE OR REPLACE FUNCTION cliente_onboarding_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS cliente_onboarding_touch_trg ON cliente_onboarding;
CREATE TRIGGER cliente_onboarding_touch_trg BEFORE UPDATE ON cliente_onboarding
  FOR EACH ROW EXECUTE FUNCTION cliente_onboarding_touch_updated_at();

-- ----------------------------------------------------------------------------
-- RLS (mismo patrón que cliente_esencia y productos)
-- ----------------------------------------------------------------------------
ALTER TABLE cliente_negocio ENABLE ROW LEVEL SECURITY;
ALTER TABLE cliente_diagnostico ENABLE ROW LEVEL SECURITY;
ALTER TABLE cliente_onboarding ENABLE ROW LEVEL SECURITY;

-- cliente_negocio
DROP POLICY IF EXISTS cn_cliente_select ON cliente_negocio;
CREATE POLICY cn_cliente_select ON cliente_negocio FOR SELECT TO authenticated
  USING (lead_id IN (SELECT id FROM leads WHERE email = auth.jwt() ->> 'email'));

DROP POLICY IF EXISTS cn_cliente_insert ON cliente_negocio;
CREATE POLICY cn_cliente_insert ON cliente_negocio FOR INSERT TO authenticated
  WITH CHECK (lead_id IN (SELECT id FROM leads WHERE email = auth.jwt() ->> 'email'));

DROP POLICY IF EXISTS cn_cliente_update ON cliente_negocio;
CREATE POLICY cn_cliente_update ON cliente_negocio FOR UPDATE TO authenticated
  USING (lead_id IN (SELECT id FROM leads WHERE email = auth.jwt() ->> 'email'))
  WITH CHECK (lead_id IN (SELECT id FROM leads WHERE email = auth.jwt() ->> 'email'));

DROP POLICY IF EXISTS cn_admin_all ON cliente_negocio;
CREATE POLICY cn_admin_all ON cliente_negocio FOR ALL TO authenticated
  USING (auth.jwt() ->> 'email' IN (SELECT email FROM usuarios_admin))
  WITH CHECK (auth.jwt() ->> 'email' IN (SELECT email FROM usuarios_admin));

DROP POLICY IF EXISTS cn_service_all ON cliente_negocio;
CREATE POLICY cn_service_all ON cliente_negocio FOR ALL TO service_role USING (true) WITH CHECK (true);

-- cliente_diagnostico
DROP POLICY IF EXISTS cd_cliente_select ON cliente_diagnostico;
CREATE POLICY cd_cliente_select ON cliente_diagnostico FOR SELECT TO authenticated
  USING (lead_id IN (SELECT id FROM leads WHERE email = auth.jwt() ->> 'email'));

DROP POLICY IF EXISTS cd_cliente_insert ON cliente_diagnostico;
CREATE POLICY cd_cliente_insert ON cliente_diagnostico FOR INSERT TO authenticated
  WITH CHECK (lead_id IN (SELECT id FROM leads WHERE email = auth.jwt() ->> 'email'));

DROP POLICY IF EXISTS cd_cliente_update ON cliente_diagnostico;
CREATE POLICY cd_cliente_update ON cliente_diagnostico FOR UPDATE TO authenticated
  USING (lead_id IN (SELECT id FROM leads WHERE email = auth.jwt() ->> 'email'))
  WITH CHECK (lead_id IN (SELECT id FROM leads WHERE email = auth.jwt() ->> 'email'));

DROP POLICY IF EXISTS cd_admin_all ON cliente_diagnostico;
CREATE POLICY cd_admin_all ON cliente_diagnostico FOR ALL TO authenticated
  USING (auth.jwt() ->> 'email' IN (SELECT email FROM usuarios_admin))
  WITH CHECK (auth.jwt() ->> 'email' IN (SELECT email FROM usuarios_admin));

DROP POLICY IF EXISTS cd_service_all ON cliente_diagnostico;
CREATE POLICY cd_service_all ON cliente_diagnostico FOR ALL TO service_role USING (true) WITH CHECK (true);

-- cliente_onboarding
DROP POLICY IF EXISTS co_cliente_select ON cliente_onboarding;
CREATE POLICY co_cliente_select ON cliente_onboarding FOR SELECT TO authenticated
  USING (lead_id IN (SELECT id FROM leads WHERE email = auth.jwt() ->> 'email'));

DROP POLICY IF EXISTS co_cliente_insert ON cliente_onboarding;
CREATE POLICY co_cliente_insert ON cliente_onboarding FOR INSERT TO authenticated
  WITH CHECK (lead_id IN (SELECT id FROM leads WHERE email = auth.jwt() ->> 'email'));

DROP POLICY IF EXISTS co_cliente_update ON cliente_onboarding;
CREATE POLICY co_cliente_update ON cliente_onboarding FOR UPDATE TO authenticated
  USING (lead_id IN (SELECT id FROM leads WHERE email = auth.jwt() ->> 'email'))
  WITH CHECK (lead_id IN (SELECT id FROM leads WHERE email = auth.jwt() ->> 'email'));

DROP POLICY IF EXISTS co_admin_all ON cliente_onboarding;
CREATE POLICY co_admin_all ON cliente_onboarding FOR ALL TO authenticated
  USING (auth.jwt() ->> 'email' IN (SELECT email FROM usuarios_admin))
  WITH CHECK (auth.jwt() ->> 'email' IN (SELECT email FROM usuarios_admin));

DROP POLICY IF EXISTS co_service_all ON cliente_onboarding;
CREATE POLICY co_service_all ON cliente_onboarding FOR ALL TO service_role USING (true) WITH CHECK (true);

COMMENT ON TABLE cliente_negocio IS 'Capa 3 del perfil: estado actual del negocio del cliente. Lo que la IA necesita para priorizar tareas y generar contenido contextual.';
COMMENT ON TABLE cliente_diagnostico IS 'Capa 4 del perfil: diagnóstico profundo en lenguaje Neurohackers. Conecta con Re-Génesis y permite a la IA hablar como el cliente lo haría.';
COMMENT ON TABLE cliente_onboarding IS 'Tracking de avance del cliente en las 4 capas del perfil. score_global se calcula como promedio.';
