// Vercel Serverless Function — AI Voice Ordering
// Accepts audio (base64 webm/opus) OR text transcript from the driver,
// sends to Google Gemini with the product catalog and order context,
// and returns structured order actions with a readback.

// Vercel function config — audio uploads need more time and body size
module.exports.config = {
  api: {
    bodyParser: { sizeLimit: '10mb' },
  },
  maxDuration: 30,
};

// ── Rate limiter ──
const rateMap = new Map();
const RATE_WINDOW = 60_000;
const RATE_MAX = 10; // 10 requests per minute per IP

function isRateLimited(ip) {
  const now = Date.now();
  const entry = rateMap.get(ip);
  if (!entry || now - entry.start > RATE_WINDOW) {
    rateMap.set(ip, { start: now, count: 1 });
    return false;
  }
  entry.count++;
  return entry.count > RATE_MAX;
}

// ── Origin check ──
const ALLOWED = ['ceciliabakery.com', 'www.ceciliabakery.com', 'localhost', '127.0.0.1', '.vercel.app'];
function isOriginAllowed(origin) {
  if (!origin) return false;
  return ALLOWED.some(a => origin.includes(a));
}

// ── Build the system prompt ──
function buildSystemPrompt(products, currentOrder, conversationHistory) {
  // Flatten product catalog into a readable list for the AI
  const catalogLines = products.map(p => {
    const catLabel = p.category || '';
    return `  - key: "${p.key}", name_en: "${p.en}", name_es: "${p.es}"${catLabel ? `, category: "${catLabel}"` : ''}`;
  }).join('\n');

  // Build current order state
  const orderLines = Object.entries(currentOrder || {})
    .filter(([_, qty]) => qty > 0)
    .map(([key, qty]) => {
      const product = products.find(p => p.key === key);
      const label = product ? (product.es || product.en) : key;
      return `  - ${label} (${key}): ${qty}`;
    }).join('\n');

  // Build conversation history
  const historyText = (conversationHistory || []).map((turn, i) => {
    if (turn.role === 'user') {
      return `Turn ${i + 1} (driver said): "${turn.transcript}"`;
    } else {
      return `Turn ${i + 1} (you responded): ${JSON.stringify(turn.actions)}`;
    }
  }).join('\n');

  return `You are a voice ordering assistant for Cecilia Bakery, a Dominican bakery in West New York, NJ. Drivers call in orders by speaking into their phone. You receive their audio and must parse it into structured order actions.

CRITICAL RULES:
1. The drivers speak in Spanish, English, or Spanglish (a mix). Understand all three fluently.
2. FUZZY MATCH product names — drivers use informal/abbreviated names:
   - "tres lech" or "tres leche" = key "tl" (Tres Leche)
   - "piña adentro" or "piña inside" = key "pina_inside"
   - "piña arriba" or "piña top" = key "pina_top"
   - "guayaba" or "guava" = match the appropriate guava product
   - "frostin" or "frosted" = frosted pieces (fr_* keys)
   - "birthday" or "cumpleaños" or "HB" = happy birthday cakes
   - "cuadrao" or "square" = square cakes
   - "basos" or "cups" = cups
   - "familiar" or "family" = family size
   - "red velvet" or "RV" = pz_rv
   - "cheesecake" or "cheese" = pz_cheese
   - "carrot" or "zanahoria" = pz_carrot
   - "chocoflan" = pz_chocoflan
   - "flan" = pz_flan
   - "pudin" or "pudding" = match the appropriate pudin product in context
3. DOZEN HANDLING — VERY IMPORTANT:
   - If the driver says "dozena", "docena", "dozen", multiply the number by 12.
   - Example: "3 dozena de tres leche" = qty 36 (3 × 12)
   - Example: "media dozena" or "half dozen" = qty 6
   - If they just say a number WITHOUT "dozen", use the number as-is.
   - Example: "dame 5 tres leche" = qty 5
4. CORRECTIONS — the driver may correct previous items:
   - "borra" / "quita" / "elimina" / "remove" / "delete" = DELETE that product (set qty to 0)
   - "ponme" / "dame" / "add" / "change to" = SET new quantity
   - "agrega" / "más" / "add more" = ADD to existing quantity
   - When they reference a product they already mentioned, match it even if they use a shortened name.
   - Example: after ordering "tres leche", if they say "borra los tres lech y ponme 5 dozena" = delete tres leche, then set tres leche to 60 (5 × 12)
5. NO TICKET variants: If the driver says "sin ticket", "no ticket", "NT", or "sin tkt", the product key should end with "_nt". For example, "tres leche sin ticket" = key "tl_nt".
6. AMBIGUITY — If the product name is ambiguous (e.g., "piña" could be inside or top, or pieces), and you cannot determine from context, pick the most common variant OR ask in the readback.
7. Return actions that ONLY reference product keys from the catalog below. Never invent keys.

PRODUCT CATALOG:
${catalogLines}

CURRENT ORDER STATE (what's already in the order):
${orderLines || '  (empty — no items yet)'}

${historyText ? `CONVERSATION HISTORY (previous voice interactions in this session):\n${historyText}\n` : ''}
YOUR RESPONSE must be ONLY a JSON object. No markdown, no code fences, no explanation. Format:
{
  "actions": [
    { "type": "set", "key": "tl", "qty": 36, "label": "Tres Leche" },
    { "type": "delete", "key": "fr_guava", "label": "Guava Frosted" }
  ],
  "readback": "A natural language summary of what you did, in the SAME language the driver mostly spoke",
  "readback_lang": "es",
  "understood_text": "what you understood from the audio transcription"
}

ACTION TYPES:
- "set": Set the quantity of a product to an exact number. If the product already exists in the order, overwrite it.
- "delete": Remove a product from the order (set to 0).
- "add": Add to the existing quantity (e.g., current 12 + add 6 = 18).

READBACK RULES:
- Write the readback in whichever language the driver spoke MOST in this recording.
- If mostly Spanish, readback in Spanish. If mostly English, in English. If Spanglish, use Spanglish.
- Set readback_lang to "es", "en", or "mixed" accordingly.
- The readback should be natural and conversational, confirming what you did.
- Include the quantity in a human-friendly way (e.g., "3 dozena" if they said dozen, but always use the calculated number in the actions).
- If you made a correction, mention what you changed.

If the transcript is unclear, empty, or not related to ordering, return:
{ "actions": [], "readback": "No entendí, intenta de nuevo", "readback_lang": "es", "understood_text": "" }`;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  // Origin check
  const origin = req.headers['origin'] || req.headers['referer'] || '';
  if (!isOriginAllowed(origin)) {
    return res.status(403).json({ success: false, message: 'Forbidden' });
  }

  // Rate limit
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim()
    || req.headers['x-real-ip']
    || req.socket?.remoteAddress || 'unknown';
  if (isRateLimited(ip)) {
    return res.status(429).json({ success: false, message: 'Too many requests. Please wait.' });
  }

  // Validate API key
  const apiKey = process.env.GOOGLE_AI_API_KEY;
  if (!apiKey) {
    console.error('GOOGLE_AI_API_KEY not set');
    return res.status(500).json({ success: false, message: 'Voice ordering not configured.' });
  }

  // Validate request body
  const { audio, transcript, products, currentOrder, conversationHistory } = req.body || {};
  if (!audio && (!transcript || !transcript.trim())) {
    return res.status(400).json({ success: false, message: 'No audio or transcript provided.' });
  }
  if (!products || !Array.isArray(products)) {
    return res.status(400).json({ success: false, message: 'No product catalog provided.' });
  }

  // Extract audio mime type and raw base64 if audio provided
  let mimeType = 'audio/webm';
  let rawBase64 = null;
  if (audio && typeof audio === 'string') {
    if (audio.startsWith('data:')) {
      const match = audio.match(/^data:(audio\/[\w\-\+\.]+);base64,(.+)$/);
      if (match) {
        mimeType = match[1];
        rawBase64 = match[2];
      }
    } else {
      rawBase64 = audio;
    }
  }

  try {
    const systemPrompt = buildSystemPrompt(products, currentOrder, conversationHistory);

    // Model fallback chain — tries newest first
    const MODELS = [
      { name: 'gemini-2.5-flash', api: 'v1beta' },
      { name: 'gemini-2.0-flash', api: 'v1beta' },
      { name: 'gemini-1.5-flash', api: 'v1beta' },
    ];

    let response = null;
    let lastError = '';
    for (const model of MODELS) {
      // Build parts — audio if available, text fallback
      const parts = [];
      if (rawBase64) {
        parts.push({ text: systemPrompt + '\n\nListen to this audio recording from a bakery driver and extract their order. Transcribe what they said and parse it into order actions.' });
        parts.push({ inlineData: { mimeType, data: rawBase64 } });
      } else {
        parts.push({ text: systemPrompt + '\n\nThe driver said the following (transcribed from speech):\n"' + transcript.trim() + '"\n\nParse this into order actions.' });
      }

      const requestBody = JSON.stringify({
        contents: [{ parts }],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 2000,
          ...(model.name.startsWith('gemini-2') ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
        },
      });

      const url = `https://generativelanguage.googleapis.com/${model.api}/models/${model.name}:generateContent?key=${apiKey}`;
      response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: requestBody,
      });

      if (response.ok) break;

      const errText = await response.text();
      console.error(`Gemini ${model.name} voice-order error:`, response.status, errText);
      lastError = errText;

      if (response.status !== 503 && response.status !== 429 && response.status !== 400) break;
      console.log(`Model ${model.name} unavailable (${response.status}), trying next...`);
    }

    if (!response || !response.ok) {
      const isQuota = lastError.includes('quota') || lastError.includes('Quota') || lastError.includes('rate');
      const detail = isQuota
        ? 'Voice ordering limit reached. Please wait a few minutes.'
        : 'AI service temporarily unavailable. Please try again.';
      return res.status(isQuota ? 429 : 502).json({ success: false, message: detail });
    }

    const data = await response.json();

    // Gemini 2.5+ may return thought + text parts
    const parts = data.candidates?.[0]?.content?.parts || [];
    const textParts = parts.filter(p => p.text && !p.thought);
    const rawContent = textParts.map(p => p.text).join('') || '{}';

    console.log('Voice order raw response (first 500 chars):', rawContent.substring(0, 500));

    // Parse JSON
    let parsed;
    try {
      let cleaned = rawContent.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      const jsonMatch = cleaned.match(/(\{[\s\S]*\})/);
      if (jsonMatch) cleaned = jsonMatch[1];
      parsed = JSON.parse(cleaned);
    } catch (parseErr) {
      console.error('Failed to parse voice order response:', rawContent);
      return res.status(500).json({
        success: false,
        message: 'Could not parse voice order. Please try again.',
        raw: rawContent.substring(0, 200)
      });
    }

    // Validate actions reference real product keys
    const validKeys = new Set(products.map(p => p.key));
    const actions = (parsed.actions || []).filter(a => {
      if (!a.key || !validKeys.has(a.key)) {
        console.warn('Voice order: invalid key filtered out:', a.key);
        return false;
      }
      return true;
    });

    return res.status(200).json({
      success: true,
      actions,
      readback: parsed.readback || '',
      readback_lang: parsed.readback_lang || 'es',
      understood_text: parsed.understood_text || '',
    });

  } catch (err) {
    console.error('Voice order error:', err.message, err.stack);
    return res.status(502).json({
      success: false,
      message: 'Could not reach AI service.',
      debug: err.message || 'Unknown error',
    });
  }
}
