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

const SYSTEM_PROMPT = `You are an OCR assistant for a bakery order system. You will receive a photo of a printed paper order ticket used by delivery drivers.

TICKET TEMPLATE — FIXED ROW ORDER:
This ticket is ALWAYS the same pre-printed form. The product table has EXACTLY these rows, ALWAYS in this order from top to bottom:

Row 1:  9226S  Birthday Cake (Small) - Dulce de Leche
Row 2:  9165S  Birthday Cake (Small) - Pineapple
Row 3:  9745   Bread Pudding Slice - 12PK
Row 4:  9158   Cake Slice Chocolate - 12PK
Row 5:  9141   Cake Slice Dulce de Leche - 12PK
Row 6:  9134   Cake Slice Guava - 12PK
Row 7:  9776   Cake Slice Pineapple - 12PK
Row 8:  9970   Chocoflan Slice - 12PK
Row 9:  9752   Flan Slice - 12PK
Row 10: 9813   Tres Leches Family - 12PK
Row 11: 9738   Tres Leches Slice - 12PK
Row 12: 9820   Cuatro Leches Slice - 12PK
Row 13: 9969   Hershey Tres Leches Slice - 12PK
Row 14: 9868   Pineapple Tres Leches Slice - 12PK
Row 15: 9875   Strawberry Tres Leches Slice - 12PK
Row 16: 9769   Strawberry Cheesecake Slice - 12PK
Row 17: 9936   Red Velvet Cake Slice - 12PK
Row 18: 9943   Carrot Cake Slice - 12PK

YOUR TASK:
For each of the 18 rows above, find the handwritten QUANTITY in the rightmost column of that row (under the printed "QUANTITY" column header). If a row has no handwritten number, skip it.

LOCATING QUANTITIES — COLUMN ANCHOR METHOD:
1. First, find the printed word "QUANTITY" in the table header row. This marks the horizontal position of the quantity column.
2. For each product row, look at the area DIRECTLY BELOW the "QUANTITY" header, on the SAME HORIZONTAL LINE as that row's printed code.
3. The handwritten number will be in that intersection (same row as the code, same column as "QUANTITY").
4. Do NOT look at any other position on the row. Only read what is directly under the QUANTITY column.

NOISE TO IGNORE COMPLETELY:
- The "/" or "✓" checkmarks to the LEFT of product codes — these are delivery confirmation marks, NOT quantities.
- Small black dots (•) that appear after some product descriptions — these are print decorations.
- The entire area ABOVE the product table (route numbers, dates like "4/16", "Sales Rt", driver IDs like "1204").
- The entire area BELOW the last product row: "Total Boxes", "Total Units", "Credit#Units", "Subtotal", "Credit", "Total", "Payment", "Balance", large handwritten dates ("4/16"), times ("7AM"), circled numbers, dollar amounts.

HANDWRITING PATTERNS — HOW THE DRIVER WRITES:
The driver writes quantities in red ink with a trailing diagonal slash mark after each number. Examples:
- "1" looks like: a single vertical stroke, followed by a diagonal slash going down-right (like "1/"). The slash is NOT a division sign — it is a checkmark. The quantity is just 1.
- "0.5" looks like: a small zero, a decimal dot, then a five, followed by the same diagonal slash (like "0.5/"). The quantity is 0.5.
- Sometimes "0.5" may appear as just ".5" (no leading zero) followed by the slash.
- "1" is THINNER — just one vertical line. "0.5" is WIDER — it has three characters (zero, dot, five) before the slash.
- If you see a single thin vertical stroke + slash, it is "1". If you see a wider mark with a dot in it, it is "0.5".

QUANTITY VALUE RULES:
- Rows 1–2 (9226S, 9165S — birthday cakes): Quantities are ALWAYS whole numbers (1, 2, 3...). Never 0.5.
- Rows 3–18 (all other products): Quantities are in multiples of 0.5. Valid values: 0.5, 1, 1.5, 2, 2.5, 3.
- Read the number EXACTLY as written. Do NOT convert, calculate, or multiply.

ALSO READ THESE TWO PRINTED VALUES FROM THE BOTTOM OF THE TICKET:
- "Total Boxes:" — a printed number (e.g., 11.5). This is the sum of non-birthday-cake quantities (rows 3–18).
- "Total Units:" — a printed number (e.g., 2). This is the count of birthday cakes (rows 1–2).

Return ONLY a JSON object (not an array). No markdown, no code fences, no explanation. Format:
{
  "items": [
    { "code": "9226S", "qty": 1, "description": "Birthday Cake (Small) - Dulce de Leche", "confident": true },
    { "code": "9776", "qty": 0.5, "description": "Cake Slice Pineapple - 12PK", "confident": true }
  ],
  "total_boxes": 11.5,
  "total_units": 2
}

Only include rows where you can see a handwritten quantity. Set "confident" to false if the quantity is hard to read.
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
    // Gemini 2.5 Flash API call
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

    const response = await fetch(geminiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: SYSTEM_PROMPT + '\n\nRead this bakery order ticket and extract all product codes and quantities.' },
            { inlineData: { mimeType, data: rawBase64 } },
          ],
        }],
        generationConfig: {
          temperature: 0,
          maxOutputTokens: 3000,
        },
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('Gemini API error:', response.status, errText);
      // Surface actual error for debugging
      let detail = 'AI service error.';
      try { detail = JSON.parse(errText)?.error?.message || detail; } catch {}
      return res.status(502).json({ success: false, message: `${detail} (${response.status})` });
    }

    const data = await response.json();
    const rawContent = data.candidates?.[0]?.content?.parts?.[0]?.text || '{}';

    // Parse the JSON from the AI response (strip markdown fences if present)
    let parsed;
    try {
      const cleaned = rawContent.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      parsed = JSON.parse(cleaned);
    } catch (parseErr) {
      console.error('Failed to parse AI response:', rawContent);
      return res.status(500).json({ success: false, message: 'Could not parse scan results.' });
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
        .reduce((sum, i) => sum + (parseFloat(i.qty) || 0), 0);
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
