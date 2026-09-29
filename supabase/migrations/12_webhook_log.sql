-- ============================================================================
-- 12_webhook_log.sql
-- Tabla de auditoría de webhooks entrantes (GHL principalmente).
-- Cada POST que llega a /functions/v1/webhook-ghl deja una fila aquí, exitoso o no.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.webhook_log (
  id BIGSERIAL PRIMARY KEY,
  recibido_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  fuente TEXT NOT NULL,
  payload JSONB,
  http_status INTEGER,
  resultado TEXT,
  error TEXT,
  lead_id UUID REFERENCES public.leads(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_webhook_log_recibido_at ON public.webhook_log(recibido_at DESC);
CREATE INDEX IF NOT EXISTS idx_webhook_log_fuente ON public.webhook_log(fuente);

ALTER TABLE public.webhook_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin_lee_webhook_log" ON public.webhook_log;
CREATE POLICY "admin_lee_webhook_log" ON public.webhook_log
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.usuarios_admin ua
      WHERE ua.email = (auth.jwt() ->> 'email')
    )
  );
