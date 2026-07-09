// Vercel Serverless Function — OCR Ticket Scanner
// Accepts a base64 image of a printed order ticket, sends it to Google Gemini 1.5 Pro vision,
// and returns structured JSON of product keys + quantities.

// ── Rate limiter ──
const rateMap = new Map();
const RATE_WINDOW = 60_000;
const RATE_MAX = 5;

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

// ── Ticket Code → System Product Key mapping ──
// Confirmed with business owner 2026-04-19
const TICKET_MAP = {
  // Birthday Cake (Small)
  '9226S': 'hb_s_dulce',
  '9165S': 'hb_s_pina',
  '9172S': 'hb_s_choco',
  '9189S': 'hb_s_guava',
  '9196S': 'hb_s_straw',
  // Birthday Cake (Large)
  '9226':  'hb_b_dulce',
  '9196':  'hb_b_straw',
  '9165':  'hb_b_pina',
  '9172':  'hb_b_choco',
  '9189':  'hb_b_guava',
  // Frosted Pieces (12PK slices WITH frosting)
  '9158':  'fr_choco',
  '9141':  'fr_dulce',
  '9134':  'fr_guava',
  '9776':  'fr_pina',
  // Pieces (12PK slices without frosting)
  '9745':  'pz_pudin',
  '9970':  'pz_chocoflan',
  '9752':  'pz_flan',
  '9936':  'pz_rv',
  '9943':  'pz_carrot',
  '9769':  'pz_cheese',
  // Tres Leche
  '9738':  'tl',
  '9820':  'cuatro_leche',
  '9969':  'tl_hershey',
  '9868':  'tl_pina',
  '9875':  'tl_straw',
  // Family Size
  '9813':  'fam_tl',
  '9011':  'fam_cl',
  // Square
  '9110':  'cdr_maiz',
  '9103':  'cdr_pound',
  '9202':  'cdr_raisin',
};

// Reverse map for the AI prompt (so it knows all valid codes)
const VALID_CODES = Object.keys(TICKET_MAP);

const SYSTEM_PROMPT = `You are an OCR assistant for a bakery order system. You will receive a photo of a printed paper order ticket or a handwritten guest check.

THE TICKET LAYOUT:
1. Printed Tickets: The ticket has a product table with CODE, DESCRIPTION, and QUANTITY / CANTIDAD.
2. Handwritten Guest Checks: The ticket is a handwritten note listing items (e.g., "2 Supiro", "30 Flan DOZ", "12 pudin pieces") without printed product codes.

YOUR TASK:
Read EVERY row in the product table or list from top to bottom. For each row that has a quantity, extract the CODE, the QUANTITY, and the UNIT. Do NOT skip any rows.

HANDWRITTEN GUEST CHECKS & MISSING CODES:
If the image is a handwritten check and does NOT have printed product codes, read the handwritten items and match them to the correct product code from this list:
- "9226S" for Small Birthday Cake Dulce de Leche ("Small cake / Supino")
- "9165S" for Small Birthday Cake Pineapple ("piña small cake", "pina")
- "9172S" for Small Birthday Cake Chocolate
- "9189S" for Small Birthday Cake Guava
- "9196S" for Small Birthday Cake Strawberry
- "9226" for Large Birthday Cake Dulce de Leche
- "9196" for Large Birthday Cake Strawberry
- "9165" for Large Birthday Cake Pineapple
- "9172" for Large Birthday Cake Chocolate
- "9189" for Large Birthday Cake Guava
- "9158" for Frosted Pieces Chocolate
- "9141" for Frosted Pieces Dulce de Leche
- "9134" for Frosted Pieces Guava
- "9776" for Frosted Pieces Pineapple
- "9745" for Bread Pudding Slice ("pudin", "pudin pieces")
- "9970" for Chocoflan ("chocoflan")
- "9752" for Flan ("flan")
- "9936" for Red Velvet Slice ("rv")
- "9943" for Carrot Cake Slice ("carrot")
- "9769" for Cheesecake Slice ("cheese cake")
- "9738" for Tres Leches ("Tres", "Tres Leches")
- "9820" for Cuatro Leches ("4Leche", "4 Leche")
- "9969" for Tres Leches Hershey ("Hershey", "3L choc")
- "9868" for Tres Leches Pineapple
- "9875" for Tres Leches Strawberry
- "9813" for Family Tres Leches ("Family Tres Leches")
- "9011" for Family Cuatro Leches ("Family Cuatro Leches")
- "9110" for Corn Square ("maiz")
- "9103" for Pound Cake Square ("pound")
- "9202" for Raisin Square ("raisin")

QUANTITY & UNIT RULES:
- "unit": If the quantity text contains "unidades", "units", or "pieces", set "unit" to "unidades". Otherwise, set "unit" to "dozen".
- "qty": Read the number exactly as written or printed (e.g. for "8 1/2 cheese cake doz", qty is 8.5 and unit is "dozen". For "36 Dulce choc pieces", qty is 36 and unit is "unidades").
- Birthday cakes (codes ending in "S" like 9226S, or 4-digit codes in the 9100-9200 range): Quantities are always whole numbers (1, 2, 3...).

Return ONLY a JSON object (not an array). No markdown, no code fences, no explanation. Format:
{
  "items": [
    { "code": "9745", "qty": 6, "unit": "unidades", "description": "Bread Pudding Slice - 12PK", "confident": true },
    { "code": "9776", "qty": 0.5, "unit": "dozen", "description": "Cake Slice Pineapple - 12PK", "confident": true }
  ],
  "total_boxes": 36.0,
  "total_units": 40
}

If the image is not an order ticket, return: { "items": [], "total_boxes": null, "total_units": null }`;


export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  // Origin check (allow bypass for iOS Shortcut client)
  const origin = req.headers['origin'] || req.headers['referer'] || '';
  const isShortcut = req.headers['x-client'] === 'shortcut' || req.query.client === 'shortcut';

  // Helper to respond with errors safely (redirects on Shortcut to prevent crashes)
  function sendError(message, statusCode = 400) {
    if (isShortcut) {
      const host = req.headers['host'] || 'ceciliabakery.com';
      const proto = host.includes('localhost') || host.includes('127.0.0.1') ? 'http' : 'https';
      const redirectUrl = `${proto}://${host}/admin-dashboard.html?shared-image-error=${encodeURIComponent(message)}`;
      return res.status(200).json({ success: true, redirect_url: redirectUrl });
    }
    return res.status(statusCode).json({ success: false, message });
  }

  if (!isShortcut && !isOriginAllowed(origin)) {
    return res.status(403).json({ success: false, message: 'Forbidden' });
  }

  // Rate limit
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim()
    || req.headers['x-real-ip']
    || req.socket?.remoteAddress || 'unknown';
  if (isRateLimited(ip)) {
    return sendError('Too many requests. Please wait a moment.', 429);
  }

  // Validate API key
  const apiKey = process.env.GOOGLE_AI_API_KEY;
  if (!apiKey) {
    console.error('GOOGLE_AI_API_KEY not set');
    return sendError('Scanner not configured on server.', 500);
  }

  try {
    // Robust body parsing (handles JSON, URL-encoded string, or raw text)
    let body = req.body || {};
    if (typeof body === 'string') {
      try {
        body = JSON.parse(body);
      } catch {
        // Try parsing urlencoded
        try {
          const params = new URLSearchParams(body);
          body = {};
          for (const [k, v] of params.entries()) {
            body[k] = v;
          }
        } catch {}
      }
    }

    const { image } = body;
    if (!image || typeof image !== 'string') {
      return sendError('No image data received. Make sure to link the Base64 variable in the Shortcut.', 400);
    }

    if (image === 'Base64 Encoded' || image.length < 50) {
      return sendError('Invalid image data. The Shortcut sent the text label instead of the actual photo variable.', 400);
    }

    // Extract raw base64 and mime type
    const isDataUrl = image.startsWith('data:image/');
    let mimeType = 'image/jpeg';
    let rawBase64 = image;
    if (isDataUrl) {
      const match = image.match(/^data:(image\/\w+);base64,(.+)$/);
      if (match) {
        mimeType = match[1];
        rawBase64 = match[2];
      }
    }

    // Model fallback chain — tries newest first, falls back to most stable
    const MODELS = [
      { name: 'gemini-3.5-flash', api: 'v1beta' },
      { name: 'gemini-2.5-flash', api: 'v1beta' },
      { name: 'gemini-2.5-flash-lite', api: 'v1beta' },
    ];

    let response = null;
    let lastError = '';
    for (const model of MODELS) {
      const requestBody = JSON.stringify({
        contents: [{
          parts: [
            { text: SYSTEM_PROMPT + '\n\nRead this bakery order ticket and extract all product codes and quantities.' },
            { inlineData: { mimeType, data: rawBase64 } },
          ],
        }],
        generationConfig: {
          temperature: 0,
          maxOutputTokens: 2000,
          ...((model.name.startsWith('gemini-2') || model.name.startsWith('gemini-3')) ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
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
      console.error(`Gemini ${model.name} error:`, response.status, errText);
      lastError = errText;

      // Only break loop immediately on auth/forbidden errors.
      // Continue to try other models on 404 (model deprecated), 429 (rate limit), or 5xx/503 (server overloaded).
      if (response.status === 401 || response.status === 403) break;
      console.log(`Model ${model.name} failed with status ${response.status}, trying next...`);
    }

    if (!response || !response.ok) {
      const isQuota = lastError.includes('quota') || lastError.includes('Quota') || lastError.includes('rate');
      return sendError(
        isQuota ? 'Scanner rate limit reached. Please wait a few minutes.' : 'AI scanner service temporarily unavailable.',
        isQuota ? 429 : 502
      );
    }

    const data = await response.json();
    const parts = data.candidates?.[0]?.content?.parts || [];
    const textParts = parts.filter(p => p.text && !p.thought);
    const rawContent = textParts.map(p => p.text).join('') || '{}';

    // Parse the JSON from the AI response
    let parsed;
    try {
      let cleaned = rawContent.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      const jsonMatch = cleaned.match(/(\{[\s\S]*\})/);
      if (jsonMatch) cleaned = jsonMatch[1];
      parsed = JSON.parse(cleaned);
    } catch (parseErr) {
      console.error('Failed to parse AI response:', rawContent);
      return sendError('AI response format was invalid. Please ensure the photo is clear.', 500);
    }

    const items = Array.isArray(parsed) ? parsed : (parsed.items || []);
    const ticketTotalBoxes = Array.isArray(parsed) ? null : (parsed.total_boxes ?? null);
    const ticketTotalUnits = Array.isArray(parsed) ? null : (parsed.total_units ?? null);

    if (!Array.isArray(items)) {
      return sendError('Invalid scan result format.', 500);
    }

    // Birthday cake codes (rows 1–2)
    const HB_CODES = new Set(['9226S','9165S','9226','9165','9196S','9196','9172S','9172','9189S','9189']);

    // Map ticket codes to system product keys
    const mapped = items.map(item => {
      const systemKey = TICKET_MAP[item.code] || null;
      return {
        code: item.code,
        description: item.description || '',
        qty: item.qty,
        unit: item.unit || 'dozen',
        confident: item.confident !== false,
        systemKey,
        matched: systemKey !== null,
      };
    });

    let mismatch = null;
    if (ticketTotalBoxes !== null) {
      const computedBoxes = items
        .filter(i => !HB_CODES.has(i.code))
        .reduce((sum, i) => {
          const qty = parseFloat(i.qty) || 0;
          const isUnidades = i.unit === 'unidades' || i.unit === 'units' || i.unit === 'unit';
          return sum + (isUnidades ? qty / 12 : qty);
        }, 0);
      const roundedComputed = Math.round(computedBoxes * 10) / 10;
      const roundedTicket = Math.round(ticketTotalBoxes * 10) / 10;

      if (roundedComputed !== roundedTicket) {
        mismatch = {
          type: 'total_boxes',
          expected: roundedTicket,
          computed: roundedComputed,
          diff: Math.round((roundedComputed - roundedTicket) * 10) / 10,
        };
      }
    }
    if (ticketTotalUnits !== null && !mismatch) {
      const computedUnits = items
        .filter(i => HB_CODES.has(i.code))
        .reduce((sum, i) => sum + (parseFloat(i.qty) || 0), 0);
      const roundedComputed = Math.round(computedUnits * 10) / 10;
      const roundedTicket = Math.round(ticketTotalUnits * 10) / 10;
      if (roundedComputed !== roundedTicket) {
        mismatch = {
          type: 'total_units',
          expected: roundedTicket,
          computed: roundedComputed,
          diff: Math.round((roundedComputed - roundedTicket) * 10) / 10,
        };
      }
    }

    let redirectUrl = null;
    if (isShortcut) {
      const shrunkItems = mapped.map(item => ({
        c: item.code,
        q: item.qty,
        u: item.unit === 'unidades' ? 'u' : 'd',
        f: item.confident ? 1 : 0
      }));
      const itemsBase64 = Buffer.from(JSON.stringify({
        items: shrunkItems,
        mismatch
      })).toString('base64')
        .replace(/\+/g, '-')    // base64url: + → -
        .replace(/\//g, '_')    // base64url: / → _
        .replace(/=+$/, '');    // strip padding =
      const host = req.headers['host'] || 'ceciliabakery.com';
      const proto = host.includes('localhost') || host.includes('127.0.0.1') ? 'http' : 'https';
      redirectUrl = `${proto}://${host}/admin-dashboard/${itemsBase64}`;
      console.log('Redirect URL generated (length):', redirectUrl.length);
      console.log('Redirect URL content:', redirectUrl);
    }

    return res.status(200).json({
      success: true,
      items: mapped,
      total: mapped.length,
      matched: mapped.filter(m => m.matched).length,
      unmatched: mapped.filter(m => !m.matched).length,
      mismatch,
      redirect_url: redirectUrl,
    });

  } catch (err) {
    console.error('Scan ticket error:', err);
    return sendError('Internal server error: ' + err.message, 500);
  }
}
