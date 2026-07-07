// ================================================================
// FUNCIÓN SERVERLESS DE VERCEL — Extraer datos fiscales de una captura
// ================================================================
// Recibe una imagen (captura de WhatsApp) y el idioma de facturación,
// llama a la API de Claude con visión y devuelve los campos fiscales
// en JSON para autocompletar el formulario.
//
// Requiere la variable de entorno ANTHROPIC_API_KEY en Vercel.
// ================================================================

const SUPABASE_URL = 'https://guuwulekfisvifobiocm.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd1dXd1bGVrZmlzdmlmb2Jpb2NtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc0NDMzNzcsImV4cCI6MjA5MzAxOTM3N30.ocdzXj4Kp8ffjLIc4IYreM9m0fYNkInHceyst184QkY';

const PISTA_IDIOMA = {
  es: 'El identificador fiscal en España se llama NIF o CIF (ej: B12345678, 12345678Z).',
  en: 'The tax ID is usually a VAT Number (e.g. GB123456789, IE1234567X). There may also be a country.',
  it: 'In Italia il codice fiscale è la Partita IVA (11 cifre) e puede aparecer un "codice univoco" o "codice destinatario" SDI (7 caracteres alfanuméricos). El código postal se llama CAP.'
};

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido' });
  }

  try {
    // ── 1. Verificar que quien llama es un usuario autenticado de la plataforma
    const authHeader = req.headers.authorization || '';
    const token = authHeader.replace(/^Bearer\s+/i, '');
    if (!token) return res.status(401).json({ error: 'No autorizado' });

    const userResp = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${token}` }
    });
    if (!userResp.ok) return res.status(401).json({ error: 'Sesión no válida. Vuelve a iniciar sesión.' });

    // ── 2. Validar entrada
    const { image, mediaType, idioma } = req.body || {};
    if (!image || !mediaType) {
      return res.status(400).json({ error: 'Faltan datos (image, mediaType)' });
    }
    if (!process.env.ANTHROPIC_API_KEY) {
      return res.status(500).json({ error: 'Falta configurar ANTHROPIC_API_KEY en Vercel (Settings → Environment Variables)' });
    }

    // ── 3. Llamar a Claude con visión
    const prompt = `La imagen es una captura de pantalla (normalmente una conversación de WhatsApp o un email) que contiene datos de facturación de un cliente. Los datos suelen venir TODO SEGUIDO en un solo mensaje, sin etiquetas, sin comas, en minúsculas, con abreviaturas o en cualquier idioma. Tu trabajo es leerlo con calma, identificar qué es cada cosa y separarlo en campos, aunque solo encuentres uno.

Campos a buscar:
- nif: identificador fiscal (NIF, CIF, DNI, NIE, VAT Number, Partita IVA, tax ID… cualquier variante). Formatos típicos: 8 dígitos + letra (12345678Z), letra + 8 dígitos (B12345678), 11 cifras italianas, VAT con prefijo de país.
- nombre_fiscal: nombre de la empresa o de la persona física a cuyo nombre va la factura (si solo hay un nombre de persona, va aquí)
- direccion: calle y número (SIN código postal, ciudad ni provincia). Pistas de que algo es una calle: "calle, c/, avda, plaza, camino, bidea, kalea, via, street, rd" o un nombre propio seguido de "n1", "nº 3", "12", "2ºB"…
- codigo_postal: 5 dígitos en España/Italia (a veces precedido de "cp" o "cap"), formatos alfanuméricos en UK/Irlanda
- provincia: provincia, ciudad, pueblo o región (si solo aparece el pueblo/ciudad, ponlo aquí)
- pais
- codice_univoco: código univoco / codice destinatario SDI italiano (~7 caracteres alfanuméricos), si aparece
- nombre_cliente: nombre de la persona de contacto, si aparece
- email_cliente: email, si aparece

Pista: ${PISTA_IDIOMA[idioma] || PISTA_IDIOMA.es}

EJEMPLO de mensaje todo seguido y cómo separarlo:
Texto en la imagen: "Perdón he visto ahora el mensaje Ainhara abaitua Beica 78931228N Askatasun bidea n1 forua cp 48393"
Respuesta correcta:
{"nif":"78931228N","nombre_fiscal":"Ainhara Abaitua Beica","direccion":"Askatasun bidea, nº 1","codigo_postal":"48393","provincia":"Forua","pais":null,"codice_univoco":null,"nombre_cliente":"Ainhara Abaitua Beica","email_cliente":null}
Fíjate: el texto de conversación ("Perdón he visto ahora el mensaje") se ignora, el DNI se detecta por su formato, lo que va después del número de portal y antes del "cp" es el pueblo, y el nombre de persona se usa como nombre fiscal.

Reglas:
1. Responde SOLO con un objeto JSON con exactamente esas claves. Nada de texto antes o después, nada de bloques de código.
2. Si un campo no aparece, pon null. NUNCA digas que no puedes leer la imagen: devuelve el JSON con lo que haya (aunque todo sea null).
3. Intenta SIEMPRE asignar cada trozo del mensaje a algún campo; deja algo en null solo si de verdad no está en la imagen.
4. Copia los valores tal y como aparecen, corrigiendo solo mayúsculas y errores obvios de tecleo/OCR.
5. No inventes ningún dato que no esté en la imagen.`;

    const aiResp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-5',
        max_tokens: 1024,
        temperature: 0,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image', source: { type: 'base64', media_type: mediaType, data: image } },
              { type: 'text', text: prompt }
            ]
          },
          // Prefill: obliga al modelo a empezar la respuesta con "{" (JSON directo)
          { role: 'assistant', content: '{' }
        ]
      })
    });

    if (!aiResp.ok) {
      let detalle = '';
      try {
        const errJson = await aiResp.json();
        detalle = errJson?.error?.message || JSON.stringify(errJson);
      } catch (_) {
        detalle = await aiResp.text().catch(() => '');
      }
      console.error('Error de la API de Claude:', aiResp.status, detalle);
      return res.status(502).json({ error: `Error de la IA (${aiResp.status}): ${detalle.slice(0, 300)}` });
    }

    const aiData = await aiResp.json();
    // Reconstruir el JSON: el prefill hace que la respuesta empiece sin la "{" inicial
    let text = '{' + (aiData.content?.[0]?.text || '').trim();
    text = text.replace(/```/g, '');
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start === -1 || end === -1 || end <= start) {
      console.error('Respuesta no JSON de la IA:', text.slice(0, 500));
      return res.status(502).json({ error: 'La IA no devolvió datos válidos. Inténtalo de nuevo.' });
    }

    let datos;
    try {
      datos = JSON.parse(text.slice(start, end + 1));
    } catch (parseErr) {
      console.error('JSON inválido de la IA:', text.slice(0, 500));
      return res.status(502).json({ error: 'La IA devolvió un formato inesperado. Inténtalo de nuevo.' });
    }

    return res.status(200).json({ datos });

  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Error interno: ' + (e.message || e) });
  }
};
