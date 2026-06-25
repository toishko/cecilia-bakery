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

const SYSTEM_PROMPT = `You are an OCR assistant for a bakery order system. You will receive a photo of a printed paper order ticket.

THE TICKET LAYOUT:
The ticket has a product table with three columns:
- CODE — a printed 4-5 character product code (e.g., 9172, 9226S, 9738)
- DESCRIPTION — the printed product name (e.g., "Birthday Cake (Large) - Chocolate", "Tres Leches Slice - 12PK")
- QUANTITY / CANTIDAD — the rightmost column containing the order quantities.

QUANTITY TYPES:
1. Printed "Unidades" (Computer-Printed): The quantities are printed by a computer and explicitly include the word "unidades" or "units" (e.g., "6 unidades", "36 unidades", "30 unidades").
2. Plain Numbers (Computer-Printed or Handwritten): The quantities are plain numbers/decimals (e.g., "0.5", "1", "1.5", "2", "3").

YOUR TASK:
Read EVERY row in the product table from top to bottom. For each row that has a quantity in the quantity/cantidad column, extract the CODE, the QUANTITY, and the UNIT. Do NOT skip any rows. There may be anywhere from 10 to 30+ rows on a ticket.

LOCATING QUANTITIES — COLUMN ANCHOR METHOD:
1. Find the printed header "QUANTITY" or "CANTIDAD". This marks the horizontal position of the quantity column.
2. For each product row, look at the area DIRECTLY BELOW that header, on the SAME HORIZONTAL LINE as that row's printed code.
3. Read the value in that intersection. Ignore any numbers outside this column.

STRICT HANDWRITING & NOISE RULES:
- IGNORE ALL handwritten scribbles, prices (e.g., "$40.80", "$234.60", "$856.95"), circled numbers (e.g., a circled "138", "110", "48", "80"), crossed-out marks, checkmarks, lines, and doodle notes on the ticket. These are just customer/staff notes.
- If the ticket has computer-printed quantities (like "6 unidades" or "36 unidades"), ignore any handwriting or circled numbers next to them or on the page entirely. Read ONLY the printed text in the table.
- Do NOT read route numbers, sales representative IDs, or metadata outside the table.

QUANTITY & UNIT RULES:
- "unit": If the quantity text contains the word "unidades" or "units", set "unit" to "unidades". Otherwise, set "unit" to "dozen".
- "qty": Read the number exactly as written or printed. Do NOT multiply, convert, or divide. For "6 unidades", qty is 6. For "0.5", qty is 0.5.
- Birthday cakes (codes ending in "S" like 9226S, 9165S, or 4-digit codes in the 9100-9200 range): Quantities are always whole numbers (1, 2, 3...).

ALSO READ THESE TWO PRINTED VALUES FROM THE BOTTOM OF THE TICKET:
- "Total Boxes:" or "TOTAL CAJAS:" — a printed number (e.g., 5.5 or 36.0).
- "Total Units:" or "TOTAL UNIDADES:" — a printed number (e.g., 12 or 40).

Return ONLY a JSON object (not an array). No markdown, no code fences, no explanation. Format:
{
  "items": [
    { "code": "9745", "qty": 6, "unit": "unidades", "description": "Bread Pudding Slice - 12PK", "confident": true },
    { "code": "9776", "qty": 0.5, "unit": "dozen", "description": "Cake Slice Pineapple - 12PK", "confident": true }
  ],
  "total_boxes": 36.0,
  "total_units": 40
}

Only include rows where you can see a quantity. Set "confident" to false if the quantity is hard to read.
If you cannot read total_boxes or total_units, set them to null.
If the image is not a bakery order ticket, return: { "items": [], "total_boxes": null, "total_units": null }`;


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
    return res.status(500).json({ success: false, message: 'Scanner not configured.' });
  }

  // Validate request body
  const { image } = req.body || {};
  if (!image || typeof image !== 'string') {
    return res.status(400).json({ success: false, message: 'No image provided.' });
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

  try {
    // Model fallback chain — tries newest first, falls back to most stable
    const MODELS = [
      { name: 'gemini-2.5-flash', api: 'v1beta' },
      { name: 'gemini-2.0-flash', api: 'v1beta' },
      { name: 'gemini-1.5-flash', api: 'v1beta' },
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
          ...(model.name.startsWith('gemini-2') ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
        },
      });

      const url = `https://generativelanguage.googleapis.com/${model.api}/models/${model.name}:generateContent?key=${apiKey}`;
      response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: requestBody,
      });

      if (response.ok) break; // success — use this response

      const errText = await response.text();
      console.error(`Gemini ${model.name} error:`, response.status, errText);
      lastError = errText;

      // Retry on 503 (overload), 429 (rate limit), or 400 (quota errors can return 400)
      if (response.status !== 503 && response.status !== 429 && response.status !== 400) break;
      console.log(`Model ${model.name} unavailable (${response.status}), trying next...`);
    }

    if (!response || !response.ok) {
      const isQuota = lastError.includes('quota') || lastError.includes('Quota') || lastError.includes('rate');
      const detail = isQuota
        ? 'Scanner limit reached. Please wait a few minutes and try again.'
        : 'AI service temporarily unavailable. Please try again.';
      return res.status(isQuota ? 429 : 502).json({ success: false, message: detail });
    }

    const data = await response.json();

    // Gemini 2.5 Flash may return multiple parts (thought + text)
    // Extract only the text parts, skip thought parts
    const parts = data.candidates?.[0]?.content?.parts || [];
    const textParts = parts.filter(p => p.text && !p.thought);
    const rawContent = textParts.map(p => p.text).join('') || '{}';

    console.log('Gemini raw response (first 500 chars):', rawContent.substring(0, 500));

    // Parse the JSON from the AI response (strip markdown fences if present)
    let parsed;
    try {
      // Strip markdown fences, backticks, and leading/trailing whitespace
      let cleaned = rawContent.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      // Also try to extract JSON from between curly braces if there's extra text
      const jsonMatch = cleaned.match(/(\{[\s\S]*\})/);
      if (jsonMatch) cleaned = jsonMatch[1];
      parsed = JSON.parse(cleaned);
    } catch (parseErr) {
      console.error('Failed to parse AI response:', rawContent);
      return res.status(500).json({ success: false, message: 'Could not parse scan results. Raw: ' + rawContent.substring(0, 200) });
    }

    // Handle both old array format and new object format
    const items = Array.isArray(parsed) ? parsed : (parsed.items || []);
    const ticketTotalBoxes = Array.isArray(parsed) ? null : (parsed.total_boxes ?? null);
    const ticketTotalUnits = Array.isArray(parsed) ? null : (parsed.total_units ?? null);

    if (!Array.isArray(items)) {
      return res.status(500).json({ success: false, message: 'Invalid scan result format.' });
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

    // ── Server-side Total Boxes validation ──
    let mismatch = null;
    if (ticketTotalBoxes !== null) {
      // Sum non-birthday-cake quantities
      const computedBoxes = items
        .filter(i => !HB_CODES.has(i.code))
        .reduce((sum, i) => {
          const qty = parseFloat(i.qty) || 0;
          const isUnidades = i.unit === 'unidades' || i.unit === 'units' || i.unit === 'unit';
          return sum + (isUnidades ? qty / 12 : qty);
        }, 0);
      // Round to avoid float precision issues
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

    return res.status(200).json({
      success: true,
      items: mapped,
      total: mapped.length,
      matched: mapped.filter(m => m.matched).length,
      unmatched: mapped.filter(m => !m.matched).length,
      mismatch,
    });

  } catch (err) {
    console.error('Scan ticket error:', err);
    return res.status(502).json({ success: false, message: 'Could not reach AI service.' });
  }
}
