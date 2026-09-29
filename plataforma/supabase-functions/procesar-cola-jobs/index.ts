// ============================================================================
// procesar-cola-jobs
// Llamado por pg_cron cada 1 min. Toma hasta N=5 jobs pendientes,
// los marca 'procesando' atómicamente, los procesa por tipo, y los completa.
//
// Tipos soportados:
//   - recalcular_salud_todos: itera leads activos, llama a recalcular_lead_semaforos
//   - sync_ghl_lead:           sincroniza un lead específico con GHL
//   - export_csv_clientes:      genera CSV en Storage (privado)
//   - pdf_libro:                genera PDF del libro Re-Génesis (pdf-lib)
//   - test_ping:                no-op, para tests
//
// Diseño anti-stuck:
// - Cada job tiene expira_at (24h). Si el cron muere a mitad de proceso, el
//   próximo tick reclama el job si pasaron >5 min sin actualizar.
// - max_intentos default 3. Si falla 3 veces, queda en 'fallido' sin reintento.
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { PDFDocument, StandardFonts, rgb } from "https://esm.sh/pdf-lib@1.17.1";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET = Deno.env.get("CRON_SECRET")!;
const BATCH_SIZE = 5;
const STUCK_AFTER_MIN = 5;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-cron-secret, content-type",
};

type Job = {
  id: string;
  tipo: string;
  lead_id: string | null;
  parametros: any;
  intentos: number;
  max_intentos: number;
};

// === Handlers por tipo ===

async function handleRecalcularSaludTodos(db: any, _job: Job): Promise<any> {
  const { data: leads } = await db
    .from("leads").select("id")
    .in("estado", ["activo", "pagado_calentamiento", "pausa"]);
  let ok = 0, fail = 0;
  for (const l of leads || []) {
    const { error } = await db.rpc("recalcular_lead_semaforos", { p_lead_id: l.id });
    if (error) fail++; else ok++;
  }
  return { ok, fail, total: (leads || []).length };
}

async function handleSyncGhlLead(db: any, job: Job): Promise<any> {
  if (!job.lead_id) throw new Error("Falta lead_id");
  const { data, error } = await db.functions.invoke("sync-ghl-perfil", {
    body: { lead_id: job.lead_id },
  });
  if (error) throw error;
  return data;
}

async function handleTestPing(_db: any, job: Job): Promise<any> {
  return { ok: true, echo: job.parametros, at: new Date().toISOString() };
}

// ============================================================================
// handlePdfLibro: genera PDF del libro Re-Génesis del lead.
//   - Lee lead + journaling_respuestas + ia_analisis ordenado por tema
//   - Arma PDF con pdf-lib (Helvetica + saltos automáticos + portada)
//   - Sube a bucket privado libros-pdf como {lead_id}/libro-{ts}.pdf
//   - Retorna signed URL con TTL 7 días
// ============================================================================
async function handlePdfLibro(db: any, job: Job): Promise<any> {
  if (!job.lead_id) throw new Error("Falta lead_id");

  const { data: lead, error: leadErr } = await db.from("leads")
    .select("id, nombre, email, fecha_activacion_programa, dias_completados")
    .eq("id", job.lead_id).maybeSingle();
  if (leadErr) throw leadErr;
  if (!lead) throw new Error("Lead no encontrado");

  // Cargar reflexiones del lead, joined con tema (orden) e IA
  const { data: respuestas, error: respErr } = await db
    .from("journaling_respuestas")
    .select(`
      id, fecha_respuesta, tema_orden, dia_relativo, pregunta_dia, respuesta_cliente, created_at,
      ia_analisis:ia_analisis (analisis, metadata)
    `)
    .eq("lead_id", job.lead_id)
    .order("fecha_respuesta", { ascending: true });
  if (respErr) throw respErr;

  // Cargar nombres de temas en orden
  const { data: temas } = await db.from("temas").select("orden, nombre").order("orden");
  const nombreTema = (orden: number) =>
    (temas || []).find((t: any) => t.orden === orden)?.nombre || `Tema ${orden}`;

  // === Construir PDF ===
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Re-Génesis — ${lead.nombre || lead.email}`);
  pdf.setAuthor("Neurohackers · Re-Génesis");
  pdf.setSubject("Libro de transformación 70 días");
  pdf.setCreator("Neurohackers Platform");

  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const fontItalic = await pdf.embedFont(StandardFonts.HelveticaOblique);

  const PAGE_W = 595.28; // A4 vertical
  const PAGE_H = 841.89;
  const MARGIN = 60;
  const LINE_H = 14;
  const TEXT_W = PAGE_W - MARGIN * 2;
  const COLOR_TEXT = rgb(0.11, 0.11, 0.12);     // #1D1D1F
  const COLOR_MUTED = rgb(0.52, 0.52, 0.55);    // #86868B
  const COLOR_ACCENT = rgb(0.83, 0.69, 0.22);   // #D4AF37
  const COLOR_SEP = rgb(0.85, 0.85, 0.88);      // #D2D2D7

  function wrap(text: string, fontRef: any, size: number, maxW: number): string[] {
    if (!text) return [""];
    const words = String(text).replace(/\r/g, "").split(/(\s+)/);
    const lines: string[] = [];
    let cur = "";
    for (const w of words) {
      const tryLine = cur + w;
      const width = fontRef.widthOfTextAtSize(tryLine.replace(/\n/g, " "), size);
      if (width > maxW && cur.trim()) {
        lines.push(cur.trimEnd());
        cur = w.replace(/^\s+/, "");
      } else if (w.includes("\n")) {
        const parts = (cur + w).split("\n");
        for (let i = 0; i < parts.length - 1; i++) lines.push(parts[i]);
        cur = parts[parts.length - 1];
      } else {
        cur = tryLine;
      }
    }
    if (cur.trim()) lines.push(cur.trimEnd());
    return lines.length ? lines : [""];
  }

  let page = pdf.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - MARGIN;

  function ensureSpace(needed: number) {
    if (y - needed < MARGIN) {
      page = pdf.addPage([PAGE_W, PAGE_H]);
      y = PAGE_H - MARGIN;
    }
  }

  function drawText(text: string, opts: { font?: any; size?: number; color?: any; gap?: number } = {}) {
    const f = opts.font || font;
    const size = opts.size || 11;
    const color = opts.color || COLOR_TEXT;
    const lines = wrap(text, f, size, TEXT_W);
    for (const line of lines) {
      ensureSpace(size + 2);
      page.drawText(line, { x: MARGIN, y, size, font: f, color });
      y -= size + (opts.gap ?? 4);
    }
  }

  function drawSeparator() {
    ensureSpace(20);
    y -= 6;
    page.drawLine({
      start: { x: MARGIN, y },
      end: { x: PAGE_W - MARGIN, y },
      thickness: 0.5, color: COLOR_SEP,
    });
    y -= 18;
  }

  // === Portada ===
  y = PAGE_H - 200;
  page.drawText("RE-GÉNESIS", {
    x: MARGIN, y, size: 36, font: fontBold, color: COLOR_TEXT,
  });
  y -= 50;
  page.drawText("Libro de transformación · 70 días", {
    x: MARGIN, y, size: 14, font: fontItalic, color: COLOR_MUTED,
  });
  y -= 60;
  page.drawText(lead.nombre || lead.email, {
    x: MARGIN, y, size: 22, font: fontBold, color: COLOR_TEXT,
  });
  y -= 30;
  page.drawText(
    `Inicio: ${lead.fecha_activacion_programa ? new Date(lead.fecha_activacion_programa).toLocaleDateString("es-ES", { day: "numeric", month: "long", year: "numeric" }) : "—"}`,
    { x: MARGIN, y, size: 11, font, color: COLOR_MUTED },
  );
  y -= 18;
  page.drawText(`Reflexiones registradas: ${(respuestas || []).length}`,
    { x: MARGIN, y, size: 11, font, color: COLOR_MUTED });

  // Línea dorada decorativa
  y -= 30;
  page.drawLine({
    start: { x: MARGIN, y }, end: { x: MARGIN + 80, y },
    thickness: 2, color: COLOR_ACCENT,
  });

  // === Reflexiones por día (paginado) ===
  page = pdf.addPage([PAGE_W, PAGE_H]);
  y = PAGE_H - MARGIN;

  drawText("REFLEXIONES", { font: fontBold, size: 9, color: COLOR_MUTED });
  y -= 4;
  drawText("Tu camino, en tu voz.", { font: fontBold, size: 22, color: COLOR_TEXT, gap: 8 });
  drawSeparator();

  let temaActual: number | null = null;
  for (const r of respuestas || []) {
    if (!r.respuesta_cliente || !String(r.respuesta_cliente).trim()) continue;

    // Encabezado de tema cuando cambia
    if (r.tema_orden !== temaActual) {
      temaActual = r.tema_orden;
      ensureSpace(60);
      y -= 10;
      page.drawRectangle({
        x: MARGIN, y: y - 2, width: 4, height: 22, color: COLOR_ACCENT,
      });
      page.drawText(`Tema ${String(r.tema_orden).padStart(2, "0")} · ${nombreTema(r.tema_orden)}`,
        { x: MARGIN + 14, y, size: 13, font: fontBold, color: COLOR_TEXT });
      y -= 28;
    }

    // Fecha + día
    const fecha = r.fecha_respuesta
      ? new Date(r.fecha_respuesta).toLocaleDateString("es-ES", { day: "numeric", month: "long" })
      : "";
    drawText(`Día ${r.dia_relativo || "?"} · ${fecha}`,
      { font: fontBold, size: 9, color: COLOR_MUTED, gap: 6 });

    // Pregunta
    if (r.pregunta_dia) {
      drawText(r.pregunta_dia, { font: fontItalic, size: 11, color: COLOR_TEXT, gap: 4 });
      y -= 4;
    }

    // Respuesta del cliente
    drawText(r.respuesta_cliente, { font, size: 11, color: COLOR_TEXT, gap: 4 });

    // Análisis IA (si existe)
    const ia = Array.isArray(r.ia_analisis) ? r.ia_analisis[0] : r.ia_analisis;
    if (ia?.analisis) {
      y -= 6;
      drawText("REFLEJO DE LA IA", { font: fontBold, size: 8, color: COLOR_ACCENT, gap: 4 });
      drawText(ia.analisis, { font: fontItalic, size: 10, color: COLOR_MUTED, gap: 3 });
    }
    drawSeparator();
  }

  if ((respuestas || []).filter((r: any) => r.respuesta_cliente?.trim()).length === 0) {
    drawText("Aún no has registrado reflexiones. Este libro se llena cada día que escribes.",
      { font: fontItalic, size: 12, color: COLOR_MUTED });
  }

  // === Footer página final ===
  const totalPaginas = pdf.getPageCount();
  for (let i = 0; i < totalPaginas; i++) {
    const p = pdf.getPage(i);
    p.drawText(`${i + 1} / ${totalPaginas}`,
      { x: PAGE_W - MARGIN - 30, y: 30, size: 8, font, color: COLOR_MUTED });
    if (i > 0) {
      p.drawText("Re-Génesis · Neurohackers",
        { x: MARGIN, y: 30, size: 8, font, color: COLOR_MUTED });
    }
  }

  const pdfBytes = await pdf.save();

  // Subir a Storage
  const filename = `libro-${Date.now()}.pdf`;
  const path = `${lead.id}/${filename}`;
  const { error: upErr } = await db.storage.from("libros-pdf")
    .upload(path, pdfBytes, { contentType: "application/pdf", upsert: false });
  if (upErr) throw upErr;

  // Signed URL 7 días
  const { data: signed, error: signErr } = await db.storage.from("libros-pdf")
    .createSignedUrl(path, 60 * 60 * 24 * 7);
  if (signErr) throw signErr;

  return {
    url: signed?.signedUrl,
    path,
    bytes: pdfBytes.length,
    reflexiones: (respuestas || []).filter((r: any) => r.respuesta_cliente?.trim()).length,
    paginas: totalPaginas,
  };
}

async function handleExportCsvClientes(db: any, job: Job): Promise<any> {
  const filtro = job.parametros?.estado || null;
  let q = db.from("leads").select("id, nombre, email, estado, fecha_pago, modalidad");
  if (filtro) q = q.eq("estado", filtro);
  const { data } = await q;
  const rows = data || [];
  const header = "id,nombre,email,estado,fecha_pago,modalidad\n";
  const csv = header + rows.map((r: any) =>
    [r.id, r.nombre, r.email, r.estado, r.fecha_pago, r.modalidad]
      .map((v: any) => `"${String(v ?? "").replace(/"/g, '""')}"`)
      .join(",")
  ).join("\n");
  const path = `exports/clientes-${Date.now()}.csv`;
  const { error: upErr } = await db.storage.from("exports")
    .upload(path, new Blob([csv], { type: "text/csv" }), { contentType: "text/csv" });
  if (upErr && !upErr.message.includes("already exists")) throw upErr;
  const { data: signed } = await db.storage.from("exports").createSignedUrl(path, 3600 * 24);
  return { rows: rows.length, path, url: signed?.signedUrl };
}

const HANDLERS: Record<string, (db: any, job: Job) => Promise<any>> = {
  recalcular_salud_todos: handleRecalcularSaludTodos,
  sync_ghl_lead: handleSyncGhlLead,
  export_csv_clientes: handleExportCsvClientes,
  pdf_libro: handlePdfLibro,
  test_ping: handleTestPing,
};

// === Main ===

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const secret = req.headers.get("x-cron-secret") || "";
  if (!CRON_SECRET || secret !== CRON_SECRET) {
    return new Response(JSON.stringify({ error: "forbidden" }), {
      status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const db = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false },
    global: { headers: { "x-cliente": "procesar-cola-jobs" } },
  });

  // 1) Liberar jobs stuck (procesando > 5 min sin actualizar)
  const stuckBefore = new Date(Date.now() - STUCK_AFTER_MIN * 60 * 1000).toISOString();
  await db.from("cola_jobs")
    .update({ estado: "pendiente", iniciado_at: null })
    .eq("estado", "procesando")
    .lt("iniciado_at", stuckBefore);

  // 2) Expirar jobs viejos
  await db.rpc("expirar_jobs_viejos");

  // 3) Tomar batch
  const { data: jobs, error: takeErr } = await db
    .from("cola_jobs")
    .select("*")
    .eq("estado", "pendiente")
    .lt("expira_at", new Date(Date.now() + 365 * 86400000).toISOString())
    .order("encolado_at")
    .limit(BATCH_SIZE);

  if (takeErr) {
    return new Response(JSON.stringify({ error: "take_failed", detail: takeErr.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (!jobs?.length) {
    return new Response(JSON.stringify({ ok: true, procesados: 0 }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const ids = jobs.map(j => j.id);
  await db.from("cola_jobs")
    .update({ estado: "procesando", iniciado_at: new Date().toISOString(), intentos: undefined })
    .in("id", ids);

  // 4) Procesar uno por uno (evita timeouts paralelos)
  const detalles: any[] = [];
  for (const job of jobs) {
    const handler = HANDLERS[job.tipo];
    if (!handler) {
      await db.from("cola_jobs").update({
        estado: "fallido",
        ultimo_error: `Tipo desconocido: ${job.tipo}`,
        completado_at: new Date().toISOString(),
      }).eq("id", job.id);
      detalles.push({ id: job.id, tipo: job.tipo, ok: false, error: "tipo_desconocido" });
      continue;
    }
    try {
      const result = await handler(db, job as Job);
      await db.from("cola_jobs").update({
        estado: "completado",
        resultado: result,
        completado_at: new Date().toISOString(),
      }).eq("id", job.id);
      detalles.push({ id: job.id, tipo: job.tipo, ok: true });
    } catch (e: any) {
      const intentosNuevos = (job.intentos || 0) + 1;
      const fallido = intentosNuevos >= (job.max_intentos || 3);
      await db.from("cola_jobs").update({
        estado: fallido ? "fallido" : "pendiente",
        intentos: intentosNuevos,
        ultimo_error: String(e?.message || e),
        completado_at: fallido ? new Date().toISOString() : null,
      }).eq("id", job.id);
      detalles.push({ id: job.id, tipo: job.tipo, ok: false, error: String(e?.message || e), intentos: intentosNuevos });
    }
  }

  return new Response(JSON.stringify({
    ok: true,
    procesados: jobs.length,
    detalles,
    at: new Date().toISOString(),
  }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
});
