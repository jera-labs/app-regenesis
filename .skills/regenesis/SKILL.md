---
name: regenesis
description: Convenciones, design tokens, paleta dorada Apple-style y reglas duras del proyecto Re-Génesis Platform (Neurohackers). Activa cada vez que crees o modifiques HTML/CSS/JS/SQL del proyecto. Incluye orden ≠ id en temas, patrones de Supabase + RLS, y configuración GHL.
---

# Skill: Re-Génesis Platform

> **Fuente única de verdad del proyecto:** [CLAUDE.md](../../CLAUDE.md). Este archivo es complemento práctico con snippets y patrones reutilizables.

## Cuándo activar

- Cualquier archivo dentro de `regenesis-platform/`.
- Trabajo con la BD Supabase (ref `eqyaddcidkywmedwscpu`).
- Cambios en estilos, componentes UI o lógica de negocio.
- Necesitas recordar el orden ≠ id en `temas` (regla CRÍTICA).

---

## Design tokens (NUNCA hardcodear, siempre `var(--token)`)

La fuente única es [public/assets/styles/tokens.css](../../public/assets/styles/tokens.css). Resumen de uso:

```css
/* Backgrounds Apple-style */
--bg: #F5F5F7              /* fondo general */
--surface: #FFFFFF         /* cards, modales */
--surface-2: #FAFAFA       /* hovers, secciones secundarias */
--surface-3: #F2F2F4       /* hover más profundo */

/* Borders */
--border: #D2D2D7
--border-soft: #E5E5EA
--border-strong: #B8B8BD

/* Text grayscale Apple */
--text: #1D1D1F
--text-muted: #86868B
--text-faint: #A1A1A6

/* Acento dorado OINL — usar con mesura */
--accent: #D4AF37          /* CTAs primarios, badges activos */
--accent-soft: #F5E9B8     /* fondos sutiles del acento */
--accent-bright: #E5C147   /* hover/active state */
--accent-dark: #B8941F     /* texto sobre fondo claro */
--accent-glow: rgba(212, 175, 55, 0.18)

/* Estados */
--error: #D70015           --error-bg: #FEF1F2
--success: #248A3D         --warning: #B25000

/* Sombras Apple suaves */
--shadow-card: 0 1px 2px rgba(0,0,0,0.04), 0 4px 16px rgba(0,0,0,0.04)
--shadow-card-hover: 0 4px 8px rgba(0,0,0,0.06), 0 16px 32px rgba(0,0,0,0.06)
--shadow-glow: 0 0 0 4px rgba(212, 175, 55, 0.2)

/* Espaciado en múltiplos de 4 */
--space-1..--space-24      /* 4px..96px */

/* Radios generosos Apple */
--radius-sm: 8px           --radius-md: 12px
--radius-lg: 18px          --radius-xl: 24px
--radius-full: 980px

/* Transiciones */
--transition-fast: 150ms cubic-bezier(0.4, 0, 0.2, 1)
--transition-base: 250ms cubic-bezier(0.4, 0, 0.2, 1)
--transition-slow: 400ms cubic-bezier(0.16, 1, 0.3, 1)
```

### Uso del acento dorado
- ✅ Botón primario (`background: var(--accent); color: #1D1D1F`).
- ✅ Badge activo, badge "Compromiso", punto pulsante.
- ✅ Línea decorativa (1px de alto) antes de un label.
- ❌ NO en backgrounds grandes.
- ❌ NO en texto largo (usar `--accent-dark` si necesitas dorado en texto).
- ❌ NO como gradiente.

> **No tocar el bloque de stats con `Reflexiones` + `Compromiso`.** Frank lo validó como el componente más importante del producto. Cualquier rediseño preserva ese módulo.

---

## Tipografía

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Geist+Mono:wght@300;400;500;600&family=Geist:wght@300;400;500;600;700;800;900&display=swap" rel="stylesheet">
```

```css
body { font-family: var(--font-sans); }
.mono { font-family: var(--font-mono); }
```

- ❌ NUNCA cursivas.
- ✅ Pesos: 300, 400, 500, 600, 700, 800, 900.
- ✅ Headings grandes con `letter-spacing: -0.03em`.
- ✅ Mono uppercase para labels/badges (`letter-spacing: 1.5px`).

---

## Iconos (Unicode, NO emojis ni SVG)

```
▦ Dashboard    ◌ Clientes    ◈ Temas        ≡ Mensajes
∼ Calentamiento ◰ Calendario  ⚙ Configuración
✓ Completado   → Siguiente   ← Volver       ↗ Abrir
●  Status activo
```

---

## Reglas de oro al trabajar con Supabase

### 1. Cliente siempre se llama `db`
```js
// La librería oficial define window.supabase. Si declaras let supabase = ...
// el script entero se rompe.
const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
```

### 2. RLS está activo en las 16 tablas
No hay modo demo. Toda consulta del cliente pasa por policies que filtran por `auth.jwt() ->> 'email'`. Si una consulta no devuelve datos, **primero verifica el JWT** y las policies con MCP, no asumas que la BD está vacía.

### 3. `anon` key sí va en frontend, `service_role` jamás
La anon key es pública por diseño. `service_role` solo en Edge Functions o scripts locales.

### 4. Orden ≠ ID en `temas`
```js
// ✅
await db.from('temas').select('*').eq('orden', lead.tema_actual_orden);
// ❌
await db.from('temas').select('*').eq('id', lead.tema_actual_orden);
```

### 5. Funciones SQL siempre con search_path fijo
```sql
CREATE OR REPLACE FUNCTION public.foo(...) RETURNS ...
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp   -- hardening obligatorio (migración 16)
AS $$ ... $$;
```

---

## Patrones reutilizables

### Escape HTML (CRÍTICO)
```js
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}
```

### Toast
```js
function showToast(mensaje, tipo = 'success') {
  const toast = document.getElementById('toast');
  toast.textContent = mensaje;
  toast.className = 'toast visible' + (tipo === 'error' ? ' error' : '');
  setTimeout(() => toast.classList.remove('visible'), 3000);
}
```

### Llamar a la Edge Function de IA (con JWT del usuario)
```js
async function llamarIA(pregunta, respuesta, tema) {
  const { data: { session } } = await db.auth.getSession();
  const res = await fetch(`${SUPABASE_URL}/functions/v1/analizar-reflexion`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${session?.access_token ?? SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify({ pregunta, respuesta, tema }),
  });
  if (!res.ok) throw new Error(`IA ${res.status}`);
  return (await res.json()).analisis;
}
```

### Routing post-login (doble rol admin+lead)
```js
// Prioridad: leads gana sobre admin. Si email tiene ambos roles,
// muestra dashboard cliente con un banner CTA al admin.
async function rutearUsuario(email) {
  const { data: lead } = await db.from('leads').select('id').eq('email', email).maybeSingle();
  if (lead) {
    mostrarDashboardCliente();
    const { data: esAdmin } = await db.from('usuarios_admin').select('email').eq('email', email).maybeSingle();
    if (esAdmin) document.getElementById('admin-banner').hidden = false;
    return;
  }
  const { data: admin } = await db.from('usuarios_admin').select('email').eq('email', email).maybeSingle();
  if (admin) { window.location.href = 'admin.html'; return; }
  await db.auth.signOut();
  mostrarErrorSinAcceso();
}
```

---

## Antipatrones a rechazar

1. Frameworks de UI (React, Vue, Svelte, Alpine) — el cliente quiere HTML simple.
2. Build steps (Webpack, Vite, etc.) — debe funcionar abriendo el HTML directo.
3. TypeScript en frontend — solo Edge Functions.
4. CSS frameworks (Tailwind, Bootstrap) — solo CSS vanilla con variables.
5. CSS-in-JS.
6. localStorage para datos sensibles — Supabase Auth maneja sesión.
7. `innerHTML` con datos del usuario sin escapar — XSS.
8. Variable global llamada `supabase` — colisiona con la librería.
9. Hardcodear `#D4AF37` o `#F5F5F7` en CSS — usar tokens.
10. Usar emojis o SVG para iconos cuando hay un Unicode equivalente.

Si el usuario pide alguno, **pregunta primero** y referencia la decisión en CLAUDE.md.

---

## Checklist antes de cerrar feature

- [ ] Variables CSS, no colores hardcoded.
- [ ] `db` para Supabase, no `supabase`.
- [ ] try/catch en async + toast en error.
- [ ] `escapeHtml()` en datos del usuario.
- [ ] Loading state visible mientras carga.
- [ ] Funciona en mobile (320px+).
- [ ] Archivo en la carpeta correcta.
- [ ] `console.log` de debug eliminado.
- [ ] Si tocaste BD, verificaste con MCP que las policies permiten la operación con el JWT del rol que la ejecuta.
- [ ] Si tocaste función SQL, lleva `SET search_path = public, pg_temp`.
