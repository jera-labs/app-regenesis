-- ============================================================================
-- Migración 78 (Re-Génesis) — bloquear regresión a 'pagado_calentamiento'
--
-- Aplicada en vivo vía Management API el 2026-06-19 (incidente de datos).
--
-- Capa 2 (definitiva) del fix del incidente. La migración 77 hizo idempotente a
-- procesar_nuevo_cliente(), pero webhook-ghl ADEMÁS hace, en cada pago de un lead
-- existente, un UPDATE directo `estado='pagado_calentamiento'` (index.ts ~L254)
-- con service_role, que pasa por encima de _leads_proteger_columnas_sensibles.
-- Por eso un pago de cuota seguía pudiendo resetear a un cliente en curso.
--
-- Este trigger garantiza, a nivel de datos y ante CUALQUIER llamador, que un
-- cliente que ya arrancó el programa nunca regrese a calentamiento, preservando
-- sus campos de programa. No existe transición legítima programa-activo ->
-- calentamiento. El resto del UPDATE (datos de contacto, fecha_pago) se permite.
-- ============================================================================

CREATE OR REPLACE FUNCTION public._leads_bloquear_regresion_calentamiento()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF OLD.estado IN ('activo','completado','pausa','caso_exito')
     AND NEW.estado = 'pagado_calentamiento' THEN
    NEW.estado                     := OLD.estado;
    NEW.tema_actual_orden          := OLD.tema_actual_orden;
    NEW.semana_actual              := OLD.semana_actual;
    NEW.dia_actual_en_tema         := OLD.dia_actual_en_tema;
    NEW.fecha_inicio_programa      := OLD.fecha_inicio_programa;
    NEW.fecha_fin_estimada         := OLD.fecha_fin_estimada;
    NEW.primer_tema_orden          := OLD.primer_tema_orden;
    NEW.fecha_inicio_calentamiento := OLD.fecha_inicio_calentamiento;

    INSERT INTO interacciones (lead_id, tipo, canal, direccion, ocurrio_at, metadata)
    VALUES (
      OLD.id, 'pago', 'manual', 'inbound', NOW(),
      jsonb_build_object('nota', 'bloqueada regresión a calentamiento (pago de cuota / webhook re-disparado)')
    );
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_leads_bloquear_regresion_calentamiento ON leads;
CREATE TRIGGER trg_leads_bloquear_regresion_calentamiento
  BEFORE UPDATE ON leads
  FOR EACH ROW EXECUTE FUNCTION public._leads_bloquear_regresion_calentamiento();