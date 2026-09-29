# -*- coding: utf-8 -*-
"""
Generador de los 5 documentos legales en formato Word para Re-Genesis / Codigo del Alma.

Documentos:
  01-Waiver-Liability-Release.docx
  02-Media-Release.docx
  03-NDA-Confidencialidad.docx
  04-Screening-Clinico-Pre-Pago.docx
  05-Cuestionario-Epigenetico.docx

Este script se ejecuta desde docs/legal/ y produce los 5 .docx en la misma carpeta.
"""

from pathlib import Path
from docx import Document
from docx.shared import Pt, Cm, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml.ns import qn
from docx.oxml import OxmlElement

OUTPUT_DIR = Path(__file__).resolve().parent

GOLD = RGBColor(0xB8, 0x94, 0x1F)   # accent-dark
TEXT = RGBColor(0x1D, 0x1D, 0x1F)
MUTED = RGBColor(0x55, 0x55, 0x5C)


# ----------------------------------------------------------------------------
# Helpers
# ----------------------------------------------------------------------------

def set_default_font(doc):
    style = doc.styles['Normal']
    style.font.name = 'Calibri'
    style.font.size = Pt(11)


def add_heading(doc, text, level=1, color=GOLD, align=WD_ALIGN_PARAGRAPH.LEFT):
    p = doc.add_paragraph()
    p.alignment = align
    run = p.add_run(text)
    run.bold = True
    run.font.color.rgb = color
    run.font.size = Pt(16 if level == 1 else 13 if level == 2 else 11)
    p.paragraph_format.space_after = Pt(6)
    p.paragraph_format.space_before = Pt(12)
    return p


def add_paragraph(doc, text, bold=False, italic=False, size=11, align=None,
                  color=None, space_after=6):
    p = doc.add_paragraph()
    if align:
        p.alignment = align
    run = p.add_run(text)
    run.bold = bold
    run.italic = italic
    run.font.size = Pt(size)
    if color:
        run.font.color.rgb = color
    p.paragraph_format.space_after = Pt(space_after)
    return p


def add_runs(doc, parts, align=None, space_after=6):
    """parts es lista de tuplas (text, dict_format)."""
    p = doc.add_paragraph()
    if align:
        p.alignment = align
    for text, fmt in parts:
        run = p.add_run(text)
        run.bold = fmt.get('bold', False)
        run.italic = fmt.get('italic', False)
        if 'size' in fmt:
            run.font.size = Pt(fmt['size'])
        if 'color' in fmt:
            run.font.color.rgb = fmt['color']
    p.paragraph_format.space_after = Pt(space_after)
    return p


def add_field_row(doc, label):
    """Inserta una fila tipo 'Etiqueta: ____________________'."""
    p = doc.add_paragraph()
    run = p.add_run(label + ': ')
    run.bold = True
    run.font.size = Pt(11)
    underline = p.add_run('_' * 60)
    underline.font.size = Pt(11)
    p.paragraph_format.space_after = Pt(8)
    return p


def add_signature_block(doc):
    """Bloque final de firma + fecha + ciudad."""
    add_heading(doc, 'FIRMA DEL PARTICIPANTE', level=2)
    add_paragraph(
        doc,
        'Al firmar abajo, declaro que he leído íntegramente este documento, '
        'comprendo plenamente sus términos y los acepto libre y voluntariamente.',
        size=10, color=MUTED, space_after=12,
    )
    add_field_row(doc, 'Nombre completo')
    add_field_row(doc, 'Firma')
    add_field_row(doc, 'Fecha (DD/MM/AAAA)')
    add_field_row(doc, 'Ciudad y país de firma')


def add_participant_id_block(doc):
    """Bloque de identificación al inicio del documento."""
    add_heading(doc, 'DATOS DEL PARTICIPANTE', level=2)
    add_paragraph(
        doc,
        'Por favor completa todos los campos antes de continuar. La información '
        'aquí registrada es vinculante para los términos de este documento.',
        size=10, color=MUTED, italic=True, space_after=10,
    )
    add_field_row(doc, 'Nombre completo')
    add_field_row(doc, 'Fecha de nacimiento (DD/MM/AAAA)')
    add_field_row(doc, 'Documento de identidad (ID estatal / pasaporte / cédula)')
    add_field_row(doc, 'Número del documento')
    add_field_row(doc, 'País de emisión del documento')
    add_field_row(doc, 'Correo electrónico')
    add_field_row(doc, 'Teléfono (con código de país)')
    add_field_row(doc, 'Dirección de residencia')


def add_findings_section(doc, findings):
    """Sección final 'NOTAS PARA REVISIÓN' con los hallazgos del documento."""
    doc.add_page_break()
    add_heading(
        doc,
        'NOTAS PARA REVISIÓN — Solo para Frank y abogado',
        level=1, color=GOLD,
    )
    add_paragraph(
        doc,
        'Esta sección NO forma parte del contrato. Es un documento de trabajo '
        'con observaciones y sugerencias. ANTES de poner el contrato en producción, '
        'eliminar esta sección o mantenerla en una versión interna separada.',
        size=10, color=MUTED, italic=True, space_after=12,
    )
    for title, items in findings:
        add_heading(doc, title, level=2, color=TEXT)
        for item in items:
            p = doc.add_paragraph(style='List Bullet')
            run = p.add_run(item)
            run.font.size = Pt(11)
            p.paragraph_format.space_after = Pt(4)


# ----------------------------------------------------------------------------
# Documento 1 — Waiver / Liability Release
# ----------------------------------------------------------------------------

def gen_01_waiver():
    doc = Document()
    set_default_font(doc)

    # Portada / título
    add_heading(
        doc, 'WAIVER · ACUERDO DE EXENCIÓN DE RESPONSABILIDAD',
        level=1, align=WD_ALIGN_PARAGRAPH.CENTER, color=GOLD,
    )
    add_paragraph(
        doc, 'Programa Re-Génesis (Código del Alma) · Neurohackers LLC',
        align=WD_ALIGN_PARAGRAPH.CENTER, italic=True, color=MUTED, space_after=14,
    )

    # Aviso destacado
    add_paragraph(
        doc,
        'IMPORTANTE: AL FIRMAR ESTE ACUERDO, USTED ESTÁ RENUNCIANDO A '
        'DERECHOS LEGALES IMPORTANTES, INCLUIDO EL DERECHO A DEMANDAR. '
        'POR FAVOR, LÉALO DETENIDAMENTE.',
        bold=True, size=11, space_after=14,
    )

    # Datos del participante
    add_participant_id_block(doc)

    # Cuerpo
    add_heading(doc, 'INTRODUCCIÓN', level=2)
    add_paragraph(
        doc,
        'Bienvenido al programa Re-Génesis (también identificado como '
        'Código del Alma). Este entrenamiento está diseñado para desafiar '
        'tus estructuras mentales y emocionales. Para participar, '
        'requerimos que asumas total soberanía sobre tu experiencia.',
    )
    add_paragraph(
        doc,
        'En consideración para que se me permita participar en los eventos, '
        'clases, entrenamientos y actividades organizadas por NEUROHACKERS LLC '
        '(en adelante, la "Compañía"), yo, el Participante identificado arriba, '
        'reconozco, entiendo y acepto lo siguiente bajo las leyes del Estado de '
        'Florida, Estados Unidos:',
    )

    add_heading(doc, '1. NATURALEZA DE LAS ACTIVIDADES Y ASUNCIÓN DE RIESGOS', level=2)
    add_paragraph(
        doc,
        'Entiendo que el programa Re-Génesis (Código del Alma) implica '
        'actividades físicas, ejercicios de respiración intensa (breathwork), '
        'dinámicas de liberación emocional y procesos psicológicos profundos. '
        'Reconozco que estas actividades conllevan riesgos inherentes, tanto '
        'conocidos como desconocidos, que incluyen, pero no se limitan a: '
        'fatiga física, estrés emocional, liberación de traumas pasados, '
        'hiperventilación, mareos y, en casos raros, lesiones físicas o '
        'angustia psicológica.',
    )
    add_paragraph(
        doc,
        'POR LA PRESENTE ASUMO DE MANERA CONSCIENTE Y VOLUNTARIA TODOS LOS '
        'RIESGOS, conocidos o desconocidos, asociados con mi participación, '
        'incluso si estos surgen de la negligencia ordinaria de la Compañía '
        'o de otros participantes.',
        bold=True,
    )

    add_heading(doc, '2. ESTADO DE SALUD Y VERACIDAD', level=2)
    add_paragraph(
        doc,
        'Certifico que me encuentro en buenas condiciones físicas y mentales '
        'para participar. Ratifico que toda la información proporcionada en '
        'mi formulario de registro médico (cuestionario de admisión clínica) '
        'es verdadera y completa. Entiendo que la Compañía confía en dicha '
        'información para permitir mi participación. Acepto no participar en '
        'dinámicas específicas si siento que mi salud está comprometida en '
        'ese momento, y notificarlo de inmediato a los facilitadores.',
    )

    add_heading(doc, '3. EXENCIÓN Y LIBERACIÓN DE RESPONSABILIDAD', level=2)
    add_paragraph(
        doc,
        'EN LA MÁXIMA MEDIDA PERMITIDA POR LA LEY DE FLORIDA, YO, EN MI '
        'NOMBRE Y EN EL DE MIS HEREDEROS, EJECUTORES Y REPRESENTANTES, '
        'LIBERO, EXIMO Y DESCARGO PARA SIEMPRE A NEUROHACKERS LLC, A SUS '
        'PROPIETARIOS, EMPLEADOS, AGENTES Y CONTRATISTAS (LAS "PARTES '
        'LIBERADAS") DE CUALQUIER RESPONSABILIDAD, RECLAMO, DEMANDA O '
        'CAUSA DE ACCIÓN DERIVADA DE O RELACIONADA CON CUALQUIER LESIÓN '
        'CORPORAL, ANGUSTIA MENTAL, MUERTE O DAÑO A LA PROPIEDAD QUE PUEDA '
        'OCURRIR DURANTE MI PARTICIPACIÓN, INCLUYENDO AQUELLOS CAUSADOS POR '
        'LA NEGLIGENCIA ORDINARIA (ORDINARY NEGLIGENCE) DE LAS PARTES '
        'LIBERADAS. Esta exención NO aplica a actos de negligencia grave '
        '(gross negligence) ni a conducta dolosa (willful misconduct).',
        bold=True,
    )

    add_heading(doc, '4. INDEMNIZACIÓN', level=2)
    add_paragraph(
        doc,
        'Acepto indemnizar y eximir de responsabilidad a Neurohackers LLC '
        'por cualquier costo, honorarios de abogados y gastos en los que la '
        'Compañía pueda incurrir como resultado de cualquier reclamo '
        'realizado por mí o en mi nombre, o por daños que yo cause a '
        'terceros durante el evento.',
    )

    add_heading(doc, '5. ATENCIÓN MÉDICA DE EMERGENCIA', level=2)
    add_paragraph(
        doc,
        'En caso de una emergencia médica, otorgo permiso a Neurohackers LLC '
        'y a sus agentes para buscar tratamiento médico de emergencia para mí '
        'si yo no puedo hacerlo. Acepto asumir todos los costos asociados con '
        'dicho tratamiento y transporte médico.',
    )

    add_heading(doc, '6. INDEPENDENCIA DE CLÁUSULAS (SEVERABILITY)', level=2)
    add_paragraph(
        doc,
        'Si alguna disposición de este Acuerdo es declarada inválida o '
        'inejecutable por un tribunal competente, las disposiciones restantes '
        'permanecerán en pleno vigor y efecto.',
    )

    add_heading(doc, '7. EFECTO VINCULANTE', level=2)
    add_paragraph(
        doc,
        'Este Acuerdo es vinculante para mí, mis herederos, ejecutores, '
        'administradores, representantes legales y cesionarios, y será '
        'oponible a cualquier reclamo presentado en mi nombre o por mi cuenta.',
    )

    add_heading(doc, '8. LEY APLICABLE Y JURISDICCIÓN', level=2)
    add_paragraph(
        doc,
        'Este Acuerdo se interpretará y regirá de acuerdo con las leyes del '
        'Estado de Florida, Estados Unidos. Cualquier disputa legal derivada '
        'de este Acuerdo deberá resolverse exclusivamente en los tribunales '
        'del Condado de Osceola (Osceola County), Florida.',
    )

    add_paragraph(
        doc,
        'HE LEÍDO ESTE ACUERDO DE EXENCIÓN DE RESPONSABILIDAD Y ASUNCIÓN DE '
        'RIESGOS, ENTIENDO PLENAMENTE SUS TÉRMINOS, Y COMPRENDO QUE HE '
        'RENUNCIADO A DERECHOS SUSTANCIALES AL FIRMARLO. LO FIRMO LIBRE Y '
        'VOLUNTARIAMENTE SIN NINGUNA COACCIÓN.',
        bold=True, space_after=14,
    )

    add_signature_block(doc)

    # Hallazgos
    findings = [
        ('Correcciones aplicadas a la versión original', [
            'Typo legal crítico corregido: "OCEOLA COUNTRY" → "Condado de Osceola (Osceola County)". El original no existe como jurisdicción.',
            'Se aclaró que la exención de responsabilidad NO aplica a "gross negligence" ni "willful misconduct" — esto era implícito por ley en Florida pero hacerlo explícito refuerza la validez del waiver.',
            'Se separó el bloque de "FIRMO ESTE CONTRATO CON MI NOMBRE Y APELLIDO TAL COMO ESTA AL INICIO DE ESTE FORMULARIO" porque ese texto referenciaba al Survey de GHL. En un contrato autocontenido se reemplaza por bloque de firma estándar.',
            'Se agregó cláusula 6 (Severability) — estándar en contratos de Florida; protege el resto del acuerdo si una cláusula es invalidada.',
            'Se agregó cláusula 7 (Effect / Binding on heirs) — común en waivers para que aplique también a herederos del firmante.',
            'Se aclaró que el "registro médico" referido en cláusula 2 es el cuestionario de admisión clínica que el cliente llena pre-pago.',
        ]),
        ('Decisiones que requieren validación de Frank', [
            'Nombre del programa: el documento original usa "Código del Alma" exclusivamente. La plataforma usa "Re-Génesis". Aquí los uní como "Re-Génesis (Código del Alma)" para que cubra ambos. Definir cuál es el nombre comercial oficial y dejar el otro como subtítulo o sinónimo.',
            'Edad mínima: este waiver asume mayoría de edad (18 años en Florida). NO permite que menores firmen. Confirmar que Re-Génesis es exclusivo para mayores de 18 (recomendado para programa con breathwork intenso).',
            'Persona jurídica: se mantiene "NEUROHACKERS LLC". Confirmar nombre exacto registrado en Florida State.',
            'Direcciones de notificación: se omitió la dirección oficial de la LLC. Si el abogado lo recomienda, agregar al final una sección "AVISOS Y NOTIFICACIONES" con la dirección de Neurohackers LLC en Florida.',
        ]),
        ('Pendientes legales — revisar con abogado de Florida', [
            'Statute of limitations: Florida tiene 4 años para personal injury. Considerar agregar cláusula de "limitations of action" para acortarlo a 1 año si el abogado lo aprueba (legal en Florida si se redacta correctamente).',
            'ESIGN/UETA: confirmar que el método de firma electrónica usado (GHL Documents & Contracts) cumple los requisitos del Florida Electronic Signature Act y federal ESIGN Act.',
            'Bilingüidad: el contrato está en español, pero la jurisdicción es Florida. Confirmar si necesitas versión bilingüe (español + inglés) o si una declaración de "el firmante manifiesta que comprende perfectamente el español y voluntariamente firma en este idioma" es suficiente. Recomendado: bilingüe.',
            'Capacidad mental: agregar declaración expresa de que el firmante no está bajo influencia de sustancias, medicamentos psicoactivos o coacción al firmar. En programas de transformación esto es buena práctica.',
            'Reembolsos y cancelación: este Waiver NO cubre el tema de pagos/reembolsos. Eso debe estar en un Contrato de Servicio aparte (no incluido en estos 5 documentos — recomiendo crear uno).',
        ]),
    ]
    add_findings_section(doc, findings)

    out = OUTPUT_DIR / '01-Waiver-Liability-Release.docx'
    doc.save(out)
    print('Generado:', out.name)


# ----------------------------------------------------------------------------
# Documento 2 — Media Release
# ----------------------------------------------------------------------------

def gen_02_media_release():
    doc = Document()
    set_default_font(doc)

    add_heading(
        doc, 'MEDIA RELEASE · LIBERACIÓN DE DERECHOS DE IMAGEN',
        level=1, align=WD_ALIGN_PARAGRAPH.CENTER, color=GOLD,
    )
    add_paragraph(
        doc, 'Programa Re-Génesis (Código del Alma) · Neurohackers LLC',
        align=WD_ALIGN_PARAGRAPH.CENTER, italic=True, color=MUTED, space_after=14,
    )

    add_paragraph(
        doc,
        'IMPORTANTE: AL FIRMAR ESTE ACUERDO, USTED OTORGA A NEUROHACKERS LLC '
        'DERECHOS PERPETUOS E IRREVOCABLES SOBRE SU IMAGEN, VOZ Y SEMEJANZA. '
        'POR FAVOR, LÉALO DETENIDAMENTE ANTES DE FIRMAR.',
        bold=True, space_after=14,
    )

    add_participant_id_block(doc)

    add_heading(doc, '1. CAPTURA DE LA EXPERIENCIA', level=2)
    add_paragraph(
        doc,
        'Entiendo que el programa Re-Génesis (Código del Alma) es un evento '
        'vivo y que NEUROHACKERS LLC documentará la experiencia para fines '
        'educativos, promocionales y de expansión de la comunidad.',
    )
    add_paragraph(
        doc,
        'Por la presente, otorgo a NEUROHACKERS LLC, sus afiliados, sucesores '
        'y cesionarios, el derecho y permiso irrevocable, perpetuo, mundial y '
        'libre de regalías para:',
    )

    add_paragraph(
        doc,
        'a) GRABAR, FOTOGRAFIAR Y CAPTURAR mi imagen, semejanza, voz y '
        'participación (en adelante, el "Material") durante el evento, '
        'sesiones presenciales, sesiones virtuales y cualquier actividad '
        'relacionada con el programa.',
    )
    add_paragraph(
        doc,
        'b) UTILIZAR, REPRODUCIR, MODIFICAR, DISTRIBUIR Y EXHIBIR el Material, '
        'total o parcialmente, en cualquier medio conocido actualmente o '
        'desarrollado en el futuro, incluyendo, pero no limitado a: redes '
        'sociales (Instagram, TikTok, YouTube, LinkedIn, Facebook), sitios '
        'web, correos electrónicos, material publicitario impreso, podcasts, '
        'cursos digitales y eventos en vivo.',
    )
    add_paragraph(
        doc,
        'c) DERECHOS DE PROPIEDAD: Reconozco que NEUROHACKERS LLC será el '
        'propietario exclusivo de todos los derechos de autor y derechos de '
        'propiedad sobre el Material producido a partir de mi participación.',
    )

    add_heading(doc, '2. ALCANCE DEL USO DE MI NOMBRE', level=2)
    add_paragraph(
        doc,
        'Autorizo expresamente a NEUROHACKERS LLC a usar mi nombre completo, '
        'mi primer nombre y la inicial de mi apellido, o únicamente mi primer '
        'nombre, junto al Material, según el criterio editorial de la Compañía. '
        'Si deseo restringir el uso de mi nombre completo, lo indicaré '
        'expresamente al final de este documento.',
    )

    add_heading(doc, '3. RENUNCIA A COMPENSACIÓN Y APROBACIÓN', level=2)
    add_paragraph(
        doc,
        'Renuncio expresamente a cualquier derecho a inspeccionar o aprobar '
        'el producto final donde aparezca mi imagen. Asimismo, renuncio a '
        'cualquier derecho a regalías, pagos u otra compensación derivada '
        'del uso de dicho Material.',
    )

    add_heading(doc, '4. LIBERACIÓN DE RECLAMOS', level=2)
    add_paragraph(
        doc,
        'Libero y eximo a NEUROHACKERS LLC, sus afiliados y cesionarios, de '
        'cualquier responsabilidad por reclamaciones relacionadas con el uso '
        'de mi imagen, incluyendo cualquier reclamo por difamación, invasión '
        'de la privacidad o derechos de publicidad bajo las leyes del Estado '
        'de Florida (Florida Statutes § 540.08) o cualquier otra jurisdicción '
        'aplicable.',
    )

    add_heading(doc, '5. CARÁCTER PERPETUO E IRREVOCABLE', level=2)
    add_paragraph(
        doc,
        'Esta autorización es perpetua e irrevocable. Entiendo que una vez '
        'que el Material haya sido publicado o incorporado a obras derivadas, '
        'NEUROHACKERS LLC no estará obligada a retirarlo, aún si en el futuro '
        'cambio de opinión sobre su uso. Esta cláusula NO me impide solicitar '
        'cordialmente la retirada de un material específico, decisión que '
        'queda a discreción de la Compañía.',
    )

    add_heading(doc, '6. INDEPENDENCIA DE CLÁUSULAS Y LEY APLICABLE', level=2)
    add_paragraph(
        doc,
        'Si alguna disposición de este Acuerdo es declarada inválida, las '
        'demás permanecerán en vigor. Este Acuerdo se rige por las leyes del '
        'Estado de Florida, EE. UU., y cualquier disputa se resolverá '
        'exclusivamente en los tribunales del Condado de Osceola (Osceola '
        'County), Florida.',
    )

    add_paragraph(
        doc,
        'HE LEÍDO ESTE MEDIA RELEASE, ENTIENDO PLENAMENTE SUS TÉRMINOS Y LO '
        'FIRMO LIBRE Y VOLUNTARIAMENTE OTORGANDO A NEUROHACKERS LLC LOS '
        'DERECHOS AQUÍ DESCRITOS.',
        bold=True, space_after=14,
    )

    add_heading(doc, 'RESTRICCIONES OPCIONALES (rellenar solo si aplica)', level=2)
    add_paragraph(
        doc,
        'Si NO autorizas el uso de tu rostro reconocible en marketing público, '
        'marca con una X aquí: [ ]',
        size=10, color=MUTED,
    )
    add_paragraph(
        doc,
        'Si NO autorizas el uso de tu nombre completo (solo nombre + inicial '
        'de apellido), marca con una X aquí: [ ]',
        size=10, color=MUTED,
    )
    add_paragraph(
        doc,
        'Si NO autorizas el uso del Material en plataformas pagas '
        '(advertising), marca con una X aquí: [ ]',
        size=10, color=MUTED, space_after=14,
    )

    add_signature_block(doc)

    findings = [
        ('Mejoras aplicadas a la versión original', [
            'Se agregó alcance explícito (sesiones presenciales, virtuales) — el original solo decía "el evento" lo cual era ambiguo.',
            'Se agregó sección 2 sobre uso del nombre — el original no aclaraba si se podía usar nombre completo o solo iniciales. Ahora el cliente puede restringirlo.',
            'Se agregó la sección 5 (carácter perpetuo) explicando qué pasa una vez publicado el material — protege a la Compañía contra solicitudes de retirada masiva.',
            'Se agregó sección de "RESTRICCIONES OPCIONALES" al final — permite que el cliente decida granularmente sin tener que rechazar todo el documento.',
            'Se agregó cláusula de severability en la sección 6.',
        ]),
        ('Decisiones que requieren validación de Frank', [
            'Restricciones opcionales: el bloque de checkboxes al final ("si NO autorizas...") es un compromiso. Frank pierde flexibilidad pero el cliente firma con más confianza. Decidir si lo dejamos o lo eliminamos completamente (todo o nada).',
            'Plataformas: el alcance incluye redes sociales nombradas. Si quieres mantener flexibilidad para futuras plataformas, ya está cubierto con "y cualquier medio desarrollado en el futuro".',
            'Material en cursos digitales: confirmar que está OK que testimonios o imágenes del cliente aparezcan dentro del propio programa (cursos digitales). Si Frank no quiere reusar internamente, eliminar esa frase.',
        ]),
        ('Pendientes legales — revisar con abogado', [
            'Florida Statutes § 540.08 ya está citado. Confirmar que la cita es correcta (es la sección de "right of publicity" para personas vivas) y que no hay statute más reciente que aplique.',
            'Menores de edad: este release NO permite firma de menores. Si Frank decide en algún momento abrir a menores, hay que crear versión paralela con consentimiento de tutor.',
            'GDPR / Ley 1581 Colombia: si va a haber clientes europeos o colombianos, considerar agregar cláusula de tratamiento de datos personales conforme a esas leyes.',
            'Revocación parcial: actualmente la autorización es irrevocable total. Algunos abogados sugieren cláusula de "right to withdraw consent for future uses upon written notice, without affecting prior uses." Decidir con el abogado.',
        ]),
    ]
    add_findings_section(doc, findings)

    out = OUTPUT_DIR / '02-Media-Release.docx'
    doc.save(out)
    print('Generado:', out.name)


# ----------------------------------------------------------------------------
# Documento 3 — NDA / Acuerdo de Confidencialidad
# ----------------------------------------------------------------------------

def gen_03_nda():
    doc = Document()
    set_default_font(doc)

    add_heading(
        doc, 'ACUERDO DE CONFIDENCIALIDAD (NDA)',
        level=1, align=WD_ALIGN_PARAGRAPH.CENTER, color=GOLD,
    )
    add_paragraph(
        doc, 'Programa Re-Génesis (Código del Alma) · Neurohackers LLC',
        align=WD_ALIGN_PARAGRAPH.CENTER, italic=True, color=MUTED, space_after=14,
    )

    add_paragraph(
        doc,
        'IMPORTANTE: AL FIRMAR ESTE ACUERDO, USTED ASUME OBLIGACIONES '
        'LEGALES DE CONFIDENCIALIDAD QUE PERSISTEN INCLUSO DESPUÉS DE '
        'TERMINAR SU PARTICIPACIÓN EN EL PROGRAMA.',
        bold=True, space_after=14,
    )

    add_participant_id_block(doc)

    add_heading(doc, '1. PARTES Y CONTEXTO', level=2)
    add_paragraph(
        doc,
        'Este Acuerdo de Confidencialidad (el "Acuerdo" o "NDA") se celebra '
        'entre NEUROHACKERS LLC (en adelante, la "Compañía"), entidad '
        'organizada bajo las leyes del Estado de Florida, EE. UU., y el '
        'Participante identificado en la sección "DATOS DEL PARTICIPANTE" '
        'arriba, en el marco de su participación en el programa Re-Génesis '
        '(Código del Alma) — en adelante, el "Programa".',
    )

    add_heading(doc, '2. INFORMACIÓN CONFIDENCIAL', level=2)
    add_paragraph(
        doc,
        'Para efectos de este Acuerdo, "Información Confidencial" significa '
        'toda información compartida por la Compañía, sus facilitadores '
        '(incluyendo, sin limitar, a Frank Ruiz y Tatiana Rojas) o por otros '
        'participantes, que no sea de dominio público, e incluye —sin '
        'limitarse a— lo siguiente:',
    )
    bullets = [
        'Metodología, contenidos, ejercicios, dinámicas y secuencia de los '
        '70 días del Programa.',
        'Materiales escritos, audiovisuales, audio, manuales, presentaciones '
        'y herramientas digitales del Programa.',
        'Procesos terapéuticos, técnicas de breathwork, dinámicas '
        'transgeneracionales y demás técnicas propietarias del Programa.',
        'Identidad, historias personales, experiencias, traumas y testimonios '
        'compartidos por otros participantes durante sesiones individuales o '
        'grupales.',
        'Información comercial de la Compañía: estructura de precios, '
        'estrategias de marketing, listas de clientes, datos de proveedores.',
        'Cualquier información identificada verbalmente o por escrito como '
        '"confidencial" o "reservada" por la Compañía o sus facilitadores.',
    ]
    for b in bullets:
        p = doc.add_paragraph(style='List Bullet')
        run = p.add_run(b)
        run.font.size = Pt(11)
        p.paragraph_format.space_after = Pt(4)

    add_heading(doc, '3. OBLIGACIONES DEL PARTICIPANTE', level=2)
    add_paragraph(
        doc,
        'El Participante se compromete a:',
    )
    obligaciones = [
        'NO divulgar, publicar, compartir, transmitir ni reproducir, total ni '
        'parcialmente, ninguna Información Confidencial a terceros, incluyendo '
        'pero sin limitarse a familiares, amigos, redes sociales, medios de '
        'comunicación, otros profesionales o competidores de la Compañía.',
        'NO usar la Información Confidencial para crear, ofrecer, replicar o '
        'comercializar cursos, talleres, libros, podcasts, contenido digital '
        'o servicios similares al Programa.',
        'Mantener absoluta confidencialidad sobre la identidad, historias y '
        'experiencias de otros participantes. Lo compartido en el círculo del '
        'Programa permanece en el círculo del Programa.',
        'NO grabar, fotografiar ni capturar de ninguna forma las sesiones del '
        'Programa sin autorización expresa y por escrito de la Compañía. La '
        'Compañía es la única autorizada a documentar las sesiones (ver '
        'Media Release).',
        'Devolver o destruir, a solicitud de la Compañía, cualquier material '
        'físico o digital del Programa que se encuentre en su poder al '
        'finalizar su participación.',
    ]
    for o in obligaciones:
        p = doc.add_paragraph(style='List Bullet')
        run = p.add_run(o)
        run.font.size = Pt(11)
        p.paragraph_format.space_after = Pt(4)

    add_heading(doc, '4. EXCEPCIONES', level=2)
    add_paragraph(
        doc,
        'Las obligaciones de confidencialidad de este Acuerdo NO aplican '
        'cuando la Información Confidencial:',
    )
    excepciones = [
        'Es o se convierte en información de dominio público sin culpa del '
        'Participante.',
        'Era ya conocida por el Participante de buena fe antes de su '
        'participación en el Programa, con evidencia documentada.',
        'Es revelada al Participante por un tercero que no esté sujeto a '
        'obligación de confidencialidad con la Compañía.',
        'Debe ser revelada por mandato judicial o por requerimiento de '
        'autoridad competente. En tal caso, el Participante notificará a la '
        'Compañía dentro de un plazo razonable para permitirle ejercer '
        'recursos legales antes de la revelación.',
        'El Participante comparte avances de su propio proceso terapéutico, '
        'sin exponer metodología propietaria, contenidos confidenciales del '
        'Programa, ni identidad o historias de otros participantes.',
    ]
    for e in excepciones:
        p = doc.add_paragraph(style='List Bullet')
        run = p.add_run(e)
        run.font.size = Pt(11)
        p.paragraph_format.space_after = Pt(4)

    add_heading(doc, '5. DURACIÓN', level=2)
    add_paragraph(
        doc,
        'Las obligaciones de confidencialidad establecidas en este Acuerdo '
        'permanecerán vigentes durante la participación del Participante en '
        'el Programa y por un período adicional de cinco (5) años después '
        'de su finalización o terminación. La obligación de proteger la '
        'identidad y experiencias de otros participantes es PERPETUA y NO '
        'expira con el plazo anterior.',
    )

    add_heading(doc, '6. RECURSOS Y PENALIDADES', level=2)
    add_paragraph(
        doc,
        'El Participante reconoce que el incumplimiento de este Acuerdo '
        'causará daños irreparables a la Compañía, difíciles de cuantificar '
        'monetariamente. En consecuencia, la Compañía tendrá derecho a '
        'solicitar:',
    )
    penalidades = [
        'Medidas cautelares (injunctive relief) para detener la divulgación.',
        'Indemnización por todos los daños y perjuicios reales que se puedan '
        'demostrar.',
        'Reembolso de honorarios razonables de abogados y costos del proceso.',
    ]
    for p_ in penalidades:
        p = doc.add_paragraph(style='List Bullet')
        run = p.add_run(p_)
        run.font.size = Pt(11)
        p.paragraph_format.space_after = Pt(4)

    add_heading(doc, '7. INDEPENDENCIA DE CLÁUSULAS', level=2)
    add_paragraph(
        doc,
        'Si alguna disposición de este Acuerdo es declarada inválida o '
        'inejecutable, las disposiciones restantes permanecerán en pleno '
        'vigor y efecto.',
    )

    add_heading(doc, '8. ACUERDO COMPLETO Y MODIFICACIONES', level=2)
    add_paragraph(
        doc,
        'Este Acuerdo, junto con el Waiver y el Media Release firmados por '
        'el Participante, constituye el acuerdo completo entre las partes '
        'respecto a la confidencialidad. Cualquier modificación requiere '
        'consentimiento por escrito de ambas partes.',
    )

    add_heading(doc, '9. LEY APLICABLE Y JURISDICCIÓN', level=2)
    add_paragraph(
        doc,
        'Este Acuerdo se rige por las leyes del Estado de Florida, EE. UU. '
        'Cualquier disputa derivada de este Acuerdo se resolverá '
        'exclusivamente en los tribunales del Condado de Osceola (Osceola '
        'County), Florida.',
    )

    add_paragraph(
        doc,
        'HE LEÍDO ESTE ACUERDO DE CONFIDENCIALIDAD, ENTIENDO PLENAMENTE SUS '
        'TÉRMINOS, ENTIENDO QUE MIS OBLIGACIONES PERSISTEN DESPUÉS DE '
        'TERMINAR EL PROGRAMA, Y LO FIRMO LIBRE Y VOLUNTARIAMENTE.',
        bold=True, space_after=14,
    )

    add_signature_block(doc)

    findings = [
        ('Sobre la versión que estás recibiendo', [
            'Esta es una versión REDACTADA POR MÍ (no es traducción de un NDA de Frank). Frank dijo que está pidiéndote la versión final del NDA. Cuando llegue la suya, COMPARA con esta y elige la mejor o consolida ambas con tu abogado.',
            'Esta versión está pensada específicamente para un programa de transformación personal con contenido propietario, dinámicas grupales y experiencias compartidas entre participantes. Es más estricta que un NDA genérico de SaaS o consultoría.',
        ]),
        ('Decisiones clave incorporadas', [
            'Plazo: 5 años post-programa para metodología y contenidos. PERPETUA para identidad y experiencias de otros participantes (estándar en programas grupales — proteger la confianza del círculo).',
            'No-replica explícita: la cláusula 3 prohíbe explícitamente que el Participante use lo aprendido para crear cursos similares. Esto es importante porque Re-Génesis tiene metodología propietaria.',
            'Excepción para proceso personal: la cláusula 4 permite al Participante hablar de su PROPIO proceso (ej: "este programa me cambió la vida") sin violar el NDA, siempre que no exponga metodología ni a otros. Esto es importante para no hacer el NDA hostil al testimonio espontáneo.',
            'Recursos: incluye injunctive relief (medidas cautelares) que es lo más fuerte que puede pedir Frank en Florida si alguien filtra material.',
        ]),
        ('Para validar con Frank antes de subir a Documents & Contracts', [
            'Plazo de 5 años: ¿es suficiente o quiere indefinido? 5 años es razonable y sostenible legalmente. Indefinido es más difícil de defender.',
            'Cláusula de no-competencia: este NDA NO incluye no-compete (no es un NDA de empleados). Si Frank quiere prohibir explícitamente que ex-participantes ofrezcan cursos similares, eso requiere una cláusula adicional con cuidado especial — los no-competes son frágiles legalmente en muchos estados.',
            'Mención de Frank Ruiz y Tatiana Rojas: están nombrados explícitamente como facilitadores. Si entra otro facilitador en el futuro, puede requerirse un anexo. Decidir si dejarlo así o decir genéricamente "los facilitadores autorizados por la Compañía".',
            'Penalidad pecuniaria liquidada: NO incluí cláusula tipo "el Participante pagará X dólares por cada incumplimiento". En Florida estas son ejecutables si reflejan daños razonables. Si Frank quiere agregar una, decirlo y la incluyo en versión 2.',
        ]),
        ('Pendientes legales', [
            'Revisar con abogado de Florida la enforceability de la cláusula 5 (perpetua sobre identidad de otros participantes) — es estándar pero debe estar redactada con cuidado.',
            'Confirmar que las "Excepciones" de la cláusula 4 están alineadas con la práctica de Florida.',
            'Si Re-Génesis va a tener participantes europeos o colombianos, considerar adaptación bilingüe y referencias a sus leyes locales.',
        ]),
    ]
    add_findings_section(doc, findings)

    out = OUTPUT_DIR / '03-NDA-Confidencialidad.docx'
    doc.save(out)
    print('Generado:', out.name)


# ----------------------------------------------------------------------------
# Documento 4 — Screening Clínico Pre-Pago
# ----------------------------------------------------------------------------

def add_yes_no(doc, pregunta, descripcion=None):
    add_paragraph(doc, pregunta, bold=True, size=11, space_after=2)
    if descripcion:
        add_paragraph(doc, descripcion, size=10, color=MUTED, italic=True, space_after=4)
    p = doc.add_paragraph()
    p.paragraph_format.left_indent = Cm(0.5)
    run = p.add_run('[ ]  Sí           [ ]  No')
    run.font.size = Pt(11)
    p.paragraph_format.space_after = Pt(10)


def gen_04_screening_clinico():
    doc = Document()
    set_default_font(doc)

    add_heading(
        doc, 'CUESTIONARIO DE ADMISIÓN CLÍNICA — PRE-PAGO',
        level=1, align=WD_ALIGN_PARAGRAPH.CENTER, color=GOLD,
    )
    add_paragraph(
        doc, 'Programa Re-Génesis (Código del Alma) · Neurohackers LLC',
        align=WD_ALIGN_PARAGRAPH.CENTER, italic=True, color=MUTED, space_after=14,
    )

    add_heading(doc, 'AVISO DE VERACIDAD Y RESPONSABILIDAD', level=2)
    add_paragraph(
        doc,
        'Bienvenido/a al proceso de admisión al programa Re-Génesis. Para '
        'tu seguridad y la del grupo, necesitamos partir de información '
        'médica real y completa.',
    )
    add_paragraph(
        doc,
        'Al completar este cuestionario, declaras y garantizas que toda la '
        'información proporcionada es FIDEDIGNA, EXACTA Y COMPLETA. Entiendes '
        'que este formulario tiene carácter de declaración vinculante y que '
        'el suministro de información falsa, alterada o inexacta no solo '
        'anulará tu participación inmediata, sino que podrá derivar en '
        'acciones y responsabilidades legales por falsedad en la información.',
        bold=True,
    )
    add_paragraph(
        doc,
        'Tu transformación comienza con la honestidad. Por favor, asegúrate '
        'de que cada dato aquí vertido sea 100% verídico antes de continuar.',
        italic=True, color=MUTED, space_after=14,
    )

    add_heading(doc, 'ACEPTACIÓN DE VERACIDAD', level=2)
    add_paragraph(
        doc,
        '[ ] Acepto y declaro bajo protesta de decir verdad que la información '
        'proporcionada es auténtica y asumo la responsabilidad legal de la misma.',
        bold=True, space_after=14,
    )

    # Datos básicos
    add_heading(doc, 'DATOS DEL PARTICIPANTE', level=2)
    add_field_row(doc, 'Nombre completo')
    add_field_row(doc, 'Apellidos')
    add_field_row(doc, 'Correo electrónico')
    add_field_row(doc, 'Fecha de nacimiento (DD/MM/AAAA)')
    add_field_row(doc, 'Teléfono (con código de país)')
    add_field_row(doc, 'País y ciudad de residencia')

    # Bloque 1: Psiquiátrico
    doc.add_page_break()
    add_heading(doc, 'BLOQUE 1 — FILTRO PSIQUIÁTRICO', level=1)
    add_paragraph(
        doc,
        'Objetivo: descartar condiciones donde el trabajo profundo de '
        'liberación emocional puede generar riesgo. Tu honestidad aquí '
        'protege tu bienestar.',
        size=10, color=MUTED, italic=True, space_after=10,
    )

    add_yes_no(
        doc,
        '1.1. Historial Psiquiátrico Diagnosticado',
        '¿Has sido diagnosticado/a profesionalmente con condiciones como '
        'esquizofrenia, trastorno bipolar, psicosis, trastorno límite de la '
        'personalidad (TLP) o paranoia?',
    )
    add_yes_no(
        doc,
        '1.2. Crisis o Intervenciones Recientes',
        'En los últimos 5 años, ¿has tenido intentos de suicidio, '
        'hospitalizaciones psiquiátricas o crisis nerviosas que requirieran '
        'intervención médica de urgencia?',
    )
    add_yes_no(
        doc,
        '1.3. Tratamiento Actual',
        '¿Actualmente te encuentras bajo tratamiento psiquiátrico o tomando '
        'medicamentos ansiolíticos, antidepresivos, antipsicóticos o '
        'estabilizadores del ánimo?',
    )
    add_paragraph(
        doc,
        'Si respondiste SÍ en alguna de las anteriores, por favor cuéntanos '
        'cuál condición y qué tratamiento llevas:',
        size=10, color=MUTED, italic=True, space_after=4,
    )
    for _ in range(3):
        add_field_row(doc, '')

    # Bloque 2: Fisiológico
    doc.add_page_break()
    add_heading(doc, 'BLOQUE 2 — FILTRO FISIOLÓGICO', level=1)
    add_paragraph(
        doc,
        'Objetivo: seguridad física. El trabajo de "neurohacking" suele subir '
        'la frecuencia cardíaca y la respiración. Necesitamos descartar '
        'riesgos inminentes.',
        size=10, color=MUTED, italic=True, space_after=10,
    )

    add_yes_no(
        doc,
        '2.1. Condición Cardiovascular',
        '¿Padeces alguna condición cardíaca (arritmias, soplos, antecedentes '
        'de infarto), usas marcapasos o sufres de hipertensión arterial no '
        'controlada?',
    )
    add_yes_no(
        doc,
        '2.2. Condición Respiratoria o Neurológica',
        '¿Sufres de asma severa, insuficiencia respiratoria, epilepsia o '
        'antecedentes de convulsiones?',
    )
    add_yes_no(
        doc,
        '2.3. Estado Físico Actual',
        '¿Estás embarazada, tienes alguna cirugía reciente (menos de 3 meses) '
        'o alguna limitación física que te impida realizar movimientos '
        'corporales o ejercicios de respiración intensa?',
    )
    add_yes_no(
        doc,
        '2.4. Adicciones Activas',
        '¿Tienes alguna adicción activa al alcohol o drogas recreativas, o '
        'has consumido alguna sustancia psicoactiva en las últimas 72 horas?',
    )
    add_paragraph(
        doc,
        'Si respondiste SÍ en alguna de las anteriores, por favor amplía '
        'detalles relevantes:',
        size=10, color=MUTED, italic=True, space_after=4,
    )
    for _ in range(3):
        add_field_row(doc, '')

    # Aviso de denegación
    doc.add_page_break()
    add_heading(doc, 'AVISO DE SEGURIDAD Y DERECHO DE DENEGACIÓN DE SERVICIO', level=2)
    add_paragraph(
        doc,
        'Neurohackers LLC se reserva el derecho, a su exclusiva discreción, '
        'de denegar la admisión o revocar la participación en el programa a '
        'cualquier solicitante si determina que dicha participación podría '
        'representar un riesgo para la salud física o mental, la seguridad '
        'o el bienestar del propio participante o de terceros. Esta '
        'determinación se basará en la información proporcionada en este '
        'formulario y en la naturaleza de alto impacto del entrenamiento.',
    )
    add_paragraph(
        doc,
        'Al enviar tu solicitud, reconoces y aceptas que Neurohackers LLC '
        'prioriza la seguridad bajo los estándares aplicables en el Estado '
        'de Florida y que sus decisiones de admisión son definitivas y se '
        'toman para proteger tu integridad física y emocional.',
    )
    add_paragraph(
        doc,
        '[ ] De acuerdo           [ ] No estoy de acuerdo',
        bold=True, space_after=14,
    )

    add_signature_block(doc)

    findings = [
        ('Por qué este documento existe separado', [
            'En el survey original de Frank (24 páginas) este filtro estaba mezclado con preguntas de epigenética, antecedentes familiares y los waivers/media release. Esto es problemático porque las preguntas de admisión clínica DEBEN responderse PRE-PAGO y las de epigenética post-pago.',
            'Este documento contiene SOLO las preguntas que determinan APTITUD para el programa (psiquiátrico, cardiovascular, respiratorio, embarazo, adicciones) más el aviso de derecho de denegación.',
            'En GHL: este cuestionario debe vivir como un Survey separado, conectado al workflow del closer. Si todas las respuestas críticas son "No", el cliente recibe el link de pago automáticamente. Si hay un "Sí" en pregunta crítica, Frank revisa manualmente antes de aprobar.',
        ]),
        ('Cambios respecto al survey original', [
            'Eliminadas las preguntas de antecedentes familiares (cáncer, diabetes, lealtades transgeneracionales) — esas pasaron al Cuestionario Epigenético del documento 5.',
            'Eliminados los textos completos del WAIVER y MEDIA RELEASE — ahora son documentos legales separados (01 y 02).',
            'Se reorganizaron las preguntas en 2 bloques claros (Psiquiátrico y Fisiológico) con introducción de objetivo en cada uno — antes estaban dispersas sin estructura.',
            'Se mantuvo el aviso de "Acepto y declaro bajo protesta de decir verdad" — es importante para la cláusula 2 del Waiver (donde el Participante ratifica que esta info es verdadera).',
            'Se mantuvo el aviso de derecho de denegación de servicio.',
        ]),
        ('Para validar con Frank', [
            '¿Faltan preguntas importantes? Este filtro tiene 7 preguntas críticas (es lo razonable para no abrumar pre-pago). Si Frank quiere agregar más, decirme cuáles para incluirlas.',
            '¿Quieres lógica de scoring automático? Ej: si hay X "Sí" en preguntas marcadas como críticas → tag "no apto" automático. Si quieres, lo armo en GHL workflow.',
            '¿Preguntas con campo de texto libre cuando responde "Sí"? Actualmente las dejé como bloque "amplía si respondiste Sí" al final de cada bloque. En GHL esto puede ser conditional logic (mostrar campo solo si la respuesta anterior fue Sí). Decirme si lo quieres así.',
        ]),
        ('Pendientes', [
            'Subir este cuestionario como Survey en GHL (NO como Documents & Contracts — surveys soportan radio buttons, contracts no).',
            'Conectar el Survey con el workflow del closer: tras submit, evaluar respuestas y aplicar tag "clinical_apto" o "clinical_revisar" según corresponda.',
            'Si "clinical_apto" → enviar link de pago automáticamente. Si "clinical_revisar" → notificar a Frank por SMS/email para decisión manual.',
            'Este cuestionario NO requiere firma legal (no es contrato). El "acepto bajo protesta de decir verdad" es suficiente para el contexto.',
        ]),
    ]
    add_findings_section(doc, findings)

    out = OUTPUT_DIR / '04-Screening-Clinico-Pre-Pago.docx'
    doc.save(out)
    print('Generado:', out.name)


# ----------------------------------------------------------------------------
# Documento 5 — Cuestionario Epigenético / Antecedentes
# ----------------------------------------------------------------------------

def gen_05_cuestionario_epigenetico():
    doc = Document()
    set_default_font(doc)

    add_heading(
        doc, 'CUESTIONARIO DE LEALTADES Y EPIGENÉTICA',
        level=1, align=WD_ALIGN_PARAGRAPH.CENTER, color=GOLD,
    )
    add_paragraph(
        doc, 'Programa Re-Génesis (Código del Alma) · Neurohackers LLC',
        align=WD_ALIGN_PARAGRAPH.CENTER, italic=True, color=MUTED, space_after=14,
    )

    add_heading(doc, 'CONTEXTO Y PROPÓSITO', level=2)
    add_paragraph(
        doc,
        'Este cuestionario forma parte del onboarding interno del programa '
        'Re-Génesis. Su objetivo es identificar patrones epigenéticos, '
        'lealtades familiares y antecedentes transgeneracionales que '
        'permitirán a Frank y Tatiana personalizar tu trabajo durante los '
        '70 días.',
    )
    add_paragraph(
        doc,
        'Estas preguntas NO son criterios de exclusión. Las respuestas que '
        'des aquí son insumo terapéutico — no afectan tu admisión ni '
        'tu acceso al programa.',
        italic=True, color=MUTED,
    )
    add_paragraph(
        doc,
        'Tómate tu tiempo. Si necesitas consultar con familiares, hazlo. '
        'Cuanto más completas sean tus respuestas, mejor podrá Frank '
        'orientar el trabajo profundo.',
        italic=True, color=MUTED, space_after=14,
    )

    # Bloque 1: Linaje físico
    doc.add_page_break()
    add_heading(doc, 'BLOQUE A — LINAJE FÍSICO Y EPIGENÉTICO', level=1)

    add_yes_no(
        doc,
        'A.1. Enfermedades Crónicas o Degenerativas (Tú o tu Clan)',
        '¿Tú, tus padres o abuelos han padecido cáncer, diabetes, '
        'enfermedades autoinmunes (lupus, esclerosis, etc.)?',
    )
    add_paragraph(
        doc,
        'Si SÍ, ¿en qué generación y de qué lado familiar? (madre/padre/abuelos)',
        size=10, color=MUTED, italic=True,
    )
    for _ in range(3):
        add_field_row(doc, '')

    add_yes_no(
        doc,
        'A.2. Enfermedades Pulmonares o de "Tristeza Profunda"',
        'En tu historia familiar o personal, ¿existen casos recurrentes de '
        'tuberculosis, neumonías graves, fibrosis o problemas pulmonares '
        'crónicos?',
    )
    for _ in range(2):
        add_field_row(doc, '')

    add_yes_no(
        doc,
        'A.3. Accidentes o Muertes Repentinas en el Linaje',
        '¿Existen en tu familia patrones de muertes jóvenes, accidentes '
        'trágicos repetidos o enfermedades fulminantes que se repitan en '
        'diferentes generaciones?',
    )
    for _ in range(2):
        add_field_row(doc, '')

    # Bloque 2: Lealtades y patrones
    doc.add_page_break()
    add_heading(doc, 'BLOQUE B — LEALTADES Y PATRONES', level=1)
    add_paragraph(
        doc,
        'Las siguientes preguntas exploran patrones que se repiten en tu '
        'sistema familiar. Responde con calma y honestidad.',
        size=10, color=MUTED, italic=True, space_after=10,
    )

    add_paragraph(
        doc,
        'B.1. ¿Qué patrones notas que se repiten en tu familia (de tus '
        'padres, abuelos o tíos hacia ti)? Ejemplos: matrimonios fallidos, '
        'dificultades económicas, problemas con la autoridad, abandonos, '
        'adicciones.',
        bold=True, space_after=4,
    )
    for _ in range(4):
        add_field_row(doc, '')

    add_paragraph(
        doc,
        'B.2. ¿Hay alguien en tu sistema familiar (vivo o muerto) con quien '
        'sientas que cargas algo no resuelto? Describe brevemente.',
        bold=True, space_after=4,
    )
    for _ in range(4):
        add_field_row(doc, '')

    add_paragraph(
        doc,
        'B.3. ¿Hay temas tabú en tu familia (secretos, vergüenzas, '
        'eventos no hablados)? Si quieres, comparte.',
        bold=True, space_after=4,
    )
    for _ in range(4):
        add_field_row(doc, '')

    add_paragraph(
        doc,
        'B.4. ¿Cuál es tu lugar en el orden de hermanos? ¿Hubo abortos, '
        'pérdidas o hijos no nacidos antes o después de ti?',
        bold=True, space_after=4,
    )
    for _ in range(3):
        add_field_row(doc, '')

    # Bloque 3: Tu intención
    doc.add_page_break()
    add_heading(doc, 'BLOQUE C — TU INTENCIÓN PARA EL PROGRAMA', level=1)

    add_paragraph(
        doc,
        'C.1. ¿Qué patrón específico quieres romper en estos 70 días? '
        '(Sé concreto)',
        bold=True, space_after=4,
    )
    for _ in range(4):
        add_field_row(doc, '')

    add_paragraph(
        doc,
        'C.2. Si pudieras heredar UNA cosa diferente a tus hijos o sobrinos '
        '(en lugar de lo que recibiste tú), ¿qué sería?',
        bold=True, space_after=4,
    )
    for _ in range(3):
        add_field_row(doc, '')

    add_paragraph(
        doc,
        'C.3. ¿Hay algo que quieras que Frank y Tatiana sepan antes de '
        'empezar, que no haya cabido en las preguntas anteriores?',
        bold=True, space_after=4,
    )
    for _ in range(4):
        add_field_row(doc, '')

    # Cierre
    doc.add_page_break()
    add_heading(doc, 'CONFIDENCIALIDAD DE TUS RESPUESTAS', level=2)
    add_paragraph(
        doc,
        'Las respuestas que entregues en este cuestionario son tratadas como '
        'información confidencial sensible. Solo serán vistas por Frank, '
        'Tatiana y los facilitadores autorizados de Neurohackers LLC, y '
        'usadas exclusivamente para personalizar tu experiencia en el '
        'programa Re-Génesis.',
    )
    add_paragraph(
        doc,
        'No se comparten con otros participantes ni se usan en marketing.',
        italic=True, color=MUTED, space_after=14,
    )

    add_paragraph(
        doc,
        '[ ] He completado este cuestionario con honestidad y entiendo que '
        'su contenido es confidencial.',
        bold=True, space_after=14,
    )

    add_field_row(doc, 'Nombre completo')
    add_field_row(doc, 'Fecha de envío')

    findings = [
        ('Por qué este documento existe separado', [
            'En el survey de 24 páginas de Frank, estas preguntas estaban revueltas con el screening clínico y los waivers. La diferencia clave: el screening clínico decide ADMISIÓN, este cuestionario es INSUMO TERAPÉUTICO.',
            'Recomendación arquitectónica: este cuestionario debe vivir DENTRO de la plataforma Re-Génesis (post-pago), idealmente como onboarding del Tema 1 (Epigenética) o como paso previo al primer mensaje del programa.',
            'Implementación sugerida: una nueva pantalla en index.html ("screen-onboarding-epigenetico") que se muestra una vez antes del primer dashboard. Datos guardados en una tabla nueva onboarding_epigenetico (lead_id, respuestas_jsonb, completado_at).',
        ]),
        ('Cambios respecto al survey original', [
            'Eliminadas las preguntas Sí/No directas de salud (ya están en el Screening Clínico — documento 4).',
            'Convertidas las preguntas a formato más narrativo (textos abiertos en lugar de solo Sí/No) — esto da mejor insumo terapéutico que un binario.',
            'Se agregaron preguntas nuevas (Bloque B y C) que no estaban en el survey original, pero que son estándar en trabajo transgeneracional/sistémico: orden de hermanos, abortos, patrones repetidos, intención del programa, mensaje a los facilitadores.',
            'Se agregó cláusula de confidencialidad al final — el cliente debe saber que estas respuestas no se comparten con nadie más.',
        ]),
        ('Para validar con Frank', [
            'Bloque B y C son sugerencias mías basadas en metodologías sistémicas (Hellinger, Ancelin-Schützenberger). Frank tiene su propia metodología — pídele que revise las preguntas y agregue/quite/reformule según su enfoque del "transgeneracional".',
            '¿Quiere que el cuestionario sea obligatorio para acceder al Tema 1, o solo recomendado? Mi recomendación: obligatorio (es insumo crítico para personalizar). Pero si Frank prefiere voluntario, lo configuramos así.',
            '¿Quiere que la app le mande email a él/Tatiana cada vez que un cliente complete el cuestionario? Recomendable para que estén al tanto antes de la primera sesión.',
        ]),
        ('Pendientes técnicos cuando me confirmes', [
            'Crear migración 22 con tabla onboarding_epigenetico.',
            'Crear pantalla "screen-onboarding-epigenetico" en index.html con las preguntas en formato form vanilla.',
            'Lógica en client-app.js: si lead activo y NO ha completado el cuestionario, redirigir a esa pantalla en lugar del dashboard.',
            'Vista admin: Frank/Tatiana pueden ver respuestas en el detail drawer del cliente.',
            'Edge function notificar-epigenetico (opcional): mail a Frank cuando un cliente completa el cuestionario.',
        ]),
    ]
    add_findings_section(doc, findings)

    out = OUTPUT_DIR / '05-Cuestionario-Epigenetico.docx'
    doc.save(out)
    print('Generado:', out.name)


# ----------------------------------------------------------------------------

if __name__ == '__main__':
    gen_01_waiver()
    gen_02_media_release()
    gen_03_nda()
    gen_04_screening_clinico()
    gen_05_cuestionario_epigenetico()
    print('Todos los documentos generados en:', OUTPUT_DIR)
