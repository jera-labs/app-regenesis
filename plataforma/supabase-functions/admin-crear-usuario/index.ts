// admin-crear-usuario v3 — passwords con CSPRNG (crypto.getRandomValues).
// v2 marcaba password_temporal=true en user_metadata.
//
// Solo admin pleno puede crear usuarios manualmente desde la plataforma.
// Tipos: cliente (leads) | admin | moderador | lector (usuarios_admin).
// Idempotente: si el auth user ya existe no duplica; resetea password solo
// con reset_password: true.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
function generarPassword(): string {
  // CSPRNG: Math.random() es predecible y estas son credenciales reales.
  // 10 chars aleatorios sobre alfabeto de 55 → ~57 bits de entropía.
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  const buf = new Uint32Array(10);
  crypto.getRandomValues(buf);
  let s = "Neuro";
  for (let i = 0; i < buf.length; i++) s += chars[buf[i] % chars.length];
  return s + "26!";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const authHeader = req.headers.get("Authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "missing_token" }, 401);

  const dbUser = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: { user }, error: userErr } = await dbUser.auth.getUser(token);
  if (userErr || !user?.email) return json({ error: "invalid_token", detail: userErr?.message }, 401);

  const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  const { data: admin } = await db.from("usuarios_admin").select("id, rol, activo").ilike("email", user.email).maybeSingle();
  if (!admin || !admin.activo || admin.rol !== "admin") {
    return json({ error: "forbidden", detail: "solo admin pleno puede crear usuarios" }, 403);
  }

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "invalid_json" }, 400); }

  const tipo = String(body.tipo || "").toLowerCase().trim();
  const email = String(body.email || "").toLowerCase().trim();
  const nombre = String(body.nombre || "").trim();
  const passwordIn = body.password ? String(body.password) : null;
  const resetPassword = Boolean(body.reset_password);
  const forceTemporal = body.password_temporal !== false; // por default true al crear

  if (!email || !email.includes("@")) return json({ error: "invalid_email" }, 400);
  if (!nombre) return json({ error: "missing_nombre" }, 400);
  if (!["cliente", "admin", "moderador", "lector"].includes(tipo)) {
    return json({ error: "invalid_tipo", detail: "tipo debe ser cliente|admin|moderador|lector" }, 400);
  }

  const password = passwordIn || generarPassword();
  const result: any = { email, nombre, tipo, password_generado: !passwordIn, password_temporal: forceTemporal };

  // 1. auth.users
  let authUserId: string | null = null;
  const { data: usersList, error: listErr } = await db.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (listErr) return json({ error: "no_pude_listar_users", detail: listErr.message }, 500);
  const existingUser = usersList?.users?.find((u: any) => u.email?.toLowerCase() === email);

  if (existingUser) {
    authUserId = existingUser.id;
    result.auth_user = "ya_existia";
    if (resetPassword) {
      const newMeta = { ...(existingUser.user_metadata || {}), password_temporal: forceTemporal, password_temporal_at: new Date().toISOString() };
      const { error: upErr } = await db.auth.admin.updateUserById(authUserId!, { password, user_metadata: newMeta });
      if (upErr) return json({ error: "no_pude_resetear_password", detail: upErr.message }, 500);
      result.auth_user = "ya_existia_password_reseteado";
    }
  } else {
    const { data: created, error: createErr } = await db.auth.admin.createUser({
      email, password,
      email_confirm: true,
      user_metadata: {
        nombre,
        password_temporal: forceTemporal,
        password_temporal_at: new Date().toISOString(),
        creado_por_admin: user.email,
      },
      app_metadata: { provider: "email", providers: ["email"] },
    });
    if (createErr || !created?.user) return json({ error: "no_pude_crear_auth_user", detail: createErr?.message }, 500);
    authUserId = created.user.id;
    result.auth_user = "creado";
  }

  // 2. leads o usuarios_admin
  if (tipo === "cliente") {
    const modalidad = String(body.modalidad || "virtual").toLowerCase();
    if (!["presencial", "virtual"].includes(modalidad)) return json({ error: "modalidad_invalida", detail: "presencial|virtual" }, 400);
    const estado = String(body.estado || "pagado_calentamiento").toLowerCase();
    const estadosOk = ["lead", "prospecto_cierre", "pagado_calentamiento", "activo", "pausa"];
    if (!estadosOk.includes(estado)) return json({ error: "estado_invalido", detail: estadosOk.join("|") }, 400);
    const cohorte_id = body.cohorte_id || null;
    const cuotas_elegidas = Number(body.cuotas_elegidas) || 1;
    const monto_total = Number(body.monto_total_programa_usd) || 0;
    const notas = body.notas_internas || `Creado manualmente desde admin por ${user.email} el ${new Date().toISOString().slice(0, 10)}.`;
    const ghl_id = body.ghl_contact_id || `manual-${Date.now()}`;

    const { data: leadExist } = await db.from("leads").select("id").ilike("email", email).maybeSingle();
    if (leadExist) { result.lead = "ya_existia"; result.lead_id = leadExist.id; }
    else {
      const { data: leadNew, error: leadErr } = await db.from("leads").insert({
        email, nombre, estado, modalidad,
        cuotas_elegidas, fecha_pago: new Date().toISOString().slice(0, 10),
        cohorte_id, ghl_contact_id: ghl_id,
        duracion_contractual_dias: 70,
        monto_total_programa_usd: monto_total,
        notas_internas: notas,
      }).select("id").single();
      if (leadErr) return json({ error: "no_pude_crear_lead", detail: leadErr.message }, 500);
      result.lead = "creado"; result.lead_id = leadNew.id;
    }
  } else {
    const { data: adminExist } = await db.from("usuarios_admin").select("id, rol").ilike("email", email).maybeSingle();
    if (adminExist) {
      result.usuario_admin = "ya_existia"; result.usuario_admin_id = adminExist.id;
      if (adminExist.rol !== tipo) {
        const { error: roleErr } = await db.from("usuarios_admin").update({ rol: tipo, activo: true }).eq("id", adminExist.id);
        if (roleErr) return json({ error: "no_pude_actualizar_rol", detail: roleErr.message }, 500);
        result.usuario_admin = "ya_existia_rol_actualizado";
      }
    } else {
      const { data: adminNew, error: admErr } = await db.from("usuarios_admin").insert({
        email, nombre, rol: tipo, activo: true,
      }).select("id").single();
      if (admErr) return json({ error: "no_pude_crear_usuario_admin", detail: admErr.message }, 500);
      result.usuario_admin = "creado"; result.usuario_admin_id = adminNew.id;
    }
  }

  result.password = password;
  result.url_login = "https://plataforma.neurohackers.cloud/login.html";
  result.creado_por = user.email;

  return json({ ok: true, ...result });
});
