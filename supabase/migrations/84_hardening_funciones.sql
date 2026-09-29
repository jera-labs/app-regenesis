-- ============================================================================
-- Migración 84: hardening de funciones SECURITY DEFINER (SaaS de agentes)
--
-- Aplicada en vivo vía Management API el 2026-06-30.
--
-- Origen: advisors de seguridad de Supabase (lint
-- anon_security_definer_function_executable). Las funciones trigger no deben
-- ser invocables vía /rest/v1/rpc por anon/authenticated (los triggers corren
-- como el dueño de la tabla, no necesitan EXECUTE del caller). mi_agente_id()
-- sí debe seguir ejecutable por authenticated: las policies RLS la evalúan con
-- el rol del que consulta.
-- ============================================================================

REVOKE EXECUTE ON FUNCTION public.agentes_touch_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.forms_touch_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.applications_touch_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.ghl_connections_touch_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.mi_agente_id() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mi_agente_id() TO authenticated;

-- Nota: la vista `agentes_publicos` (mig 79) queda intencionalmente con
-- semántica definer: es el único camino público y solo proyecta columnas
-- seguras (nombre, slug, branding) de agentes activos.
