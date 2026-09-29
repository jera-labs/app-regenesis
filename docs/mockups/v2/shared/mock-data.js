// ==========================================================
// Datos de ejemplo para mockups v2.
// Personaje: Mateo (test user actual) — para que Frank vea
// la plataforma con datos creíbles y consistentes entre páginas.
// ==========================================================

window.MOCK = {
  cliente: {
    nombre: 'Alexander González',
    primer_nombre: 'Alex',
    iniciales: 'AG',
    email: 'alex@marketingnativo.com',
    pais: 'Colombia',
    ciudad: 'Medellín',
    fecha_pago: '2026-05-18',
    dia_programa: 6,
    semana: 1,
    de_70: 70,
    tema_actual: 'Niño Interior',
    tema_orden: 4,
  },
  personaje: {
    nombre: 'Mateo',
    descripcion: 'Mateo, 38 años. Vive en Orlando. Lleva una empresa propia desde hace 8 años. Por fuera se ve seguro, exitoso, en control. Por dentro carga un cansancio que no se permite mostrar.',
    dias_restantes: 359,
    creado_at: '2026-05-19',
  },
  assessment: {
    facturacion_actual: 8500,
    meta_6_meses: 35000,
    bloqueo_principal: 'No logro cerrar más de 2 ventas por semana aunque tengo el flujo de leads',
    modelo: 'Servicios de consultoría B2B',
    perfil_ia: 'Ejecutor con cuello de botella en cierre. Operando, no escalando.',
  },
  hub: {
    progreso_dia: { hecho: 4, total: 7 },
    ventas_mes: 3,
    monto_acumulado: 7800,
    meta_acumulada: 35000,
    racha: 6,
    skool_porcentaje: 42,
    proxima_sesion: {
      tipo: 'Sesión grupal con Tatiana',
      fecha: 'Jueves 28 mayo',
      hora: '7:00 PM ET',
      eta_dias: 2,
    },
    pendientes_hoy: 3,
  },
  success_board: {
    tareas: [
      { id: 1, label: 'Entrar a Skool y ver el video del día (15 min)',  done: true,  meta: 'Módulo: Cierre por valor' },
      { id: 2, label: 'Responder la reflexión del día en Re-Génesis',    done: true,  meta: 'Niño Interior · Día 6' },
      { id: 3, label: 'Prospectar 3 nuevos contactos por LinkedIn',       done: true,  meta: 'Mensaje plantilla en Recursos' },
      { id: 4, label: 'Publicar 1 post en Instagram (template aprobado)', done: true,  meta: 'Borrador listo en CRM' },
      { id: 5, label: 'Actualizar tu pipeline en el CRM',                  done: false, meta: 'Mueve oportunidades de etapa' },
      { id: 6, label: 'Llamar a 2 leads calientes',                        done: false, meta: 'Lista priorizada por la IA' },
      { id: 7, label: 'Registrar las ventas cerradas hoy',                 done: false, meta: 'Si hubo cierre, súbelo aquí' },
    ],
  },
  ventas: {
    registradas: [
      { fecha: '2026-05-24', cliente: 'Carla M.',   monto: 2800, tipo: 'Consultoría 3 meses' },
      { fecha: '2026-05-21', cliente: 'Diego P.',   monto: 3500, tipo: 'Setup + retainer' },
      { fecha: '2026-05-20', cliente: 'Lucía R.',   monto: 1500, tipo: 'Audit + roadmap' },
    ],
    hitos: [
      { monto: 5000,  alcanzado: true,  label: 'Bronce',   fecha: '2026-05-22' },
      { monto: 10000, alcanzado: false, label: 'Plata',    fecha: null },
      { monto: 20000, alcanzado: false, label: 'Oro',      fecha: null },
      { monto: 50000, alcanzado: false, label: 'Platino',  fecha: null },
    ],
    ranking: [
      { nombre: 'Damaris S.',   iniciales: 'DS', monto: 18500 },
      { nombre: 'Arlin C.',     iniciales: 'AC', monto: 12300 },
      { nombre: 'Alexander G.', iniciales: 'AG', monto: 7800 },
    ],
  },
  recursos: {
    expertos: [
      { id: 'frank',    nombre: 'Frank Ruiz',     rol: 'Mentor principal · Transformación',     iniciales: 'FR' },
      { id: 'paola-s',  nombre: 'Paola Segura',   rol: 'Consultora · Gestión del cambio',        iniciales: 'PS' },
      { id: 'paola-c',  nombre: 'Paola Canchón',  rol: 'Cierre de alta conversión',              iniciales: 'PC' },
      { id: 'ronald',   nombre: 'Ronald',         rol: 'Marketing digital y crecimiento',        iniciales: 'RO' },
      { id: 'alex',     nombre: 'Alexander G.',   rol: 'IA, automatizaciones y arquitectura',    iniciales: 'AG' },
      { id: 'tatiana',  nombre: 'Tatiana Rojas',  rol: 'Logística y soporte',                    iniciales: 'TR' },
    ],
    items_destacados: [
      { titulo: 'Plantilla LinkedIn outbound que cierra 1 de cada 8', experto: 'Paola Canchón', tipo: 'Template', tiempo: '8 min', recomendado: true },
      { titulo: 'GPT entrenado para responder objeciones por WhatsApp', experto: 'Alexander G.', tipo: 'Herramienta IA', tiempo: '15 min', recomendado: true },
      { titulo: 'Cómo estructurar tu primera llamada de cierre',      experto: 'Paola Canchón', tipo: 'Video', tiempo: '12 min', recomendado: false },
      { titulo: 'Calendario editorial mensual en 90 minutos',          experto: 'Ronald',        tipo: 'Workshop', tiempo: '90 min', recomendado: true },
      { titulo: 'Setup completo de embudo en GoHighLevel',             experto: 'Alexander G.', tipo: 'Tutorial', tiempo: '45 min', recomendado: false },
      { titulo: 'Mentalidad de precios premium: 5 ejercicios',          experto: 'Frank Ruiz',    tipo: 'Ejercicio', tiempo: '30 min', recomendado: false },
    ],
  },
  skool: {
    cursos: [
      { titulo: 'Fundamentos de Sombra y Mentalidad',     completados: 8, total: 8,  porcentaje: 100 },
      { titulo: 'Estructura Gerencial para Founders',     completados: 5, total: 12, porcentaje: 42 },
      { titulo: 'Laboratorio de Ventas Práctico',         completados: 3, total: 10, porcentaje: 30 },
      { titulo: 'Setup de CRM y Automatizaciones',        completados: 0, total: 7,  porcentaje: 0 },
    ],
  },
  reflexion: {
    pregunta: 'Hoy, como adulto, hay momentos donde tu reacción es más vieja que tú. Un comentario te tira al piso, una pelea te enmudece, un desafío te paraliza. En ese momento, no estás reaccionando como adulto, está hablando el niño. ¿En qué situaciones notas que ese niño toma el volante?',
    pregunta_personaje: 'Lo que describes no es debilidad, es una *lealtad invisible* a un niño que aprendió a callar para sobrevivir. Mateo carga el mismo nudo: posterga las llamadas difíciles porque algo en él sigue esperando aprobación antes de hablar.\n\n¿Qué decisión concreta va a tomar Mateo hoy para hablar primero, sabiendo que le quedan 359 días de vida?',
    cierre: 'Mateo, lo que tu negocio te pide es lo que llevas años postergándole. Antes de las 6 PM de hoy, haz UNA llamada que vienes evitando. Sin guion, sin perfeccionar. Solo marca. El niño aprende cuando el adulto actúa.',
    racha: 6,
  },
};
