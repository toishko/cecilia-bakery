// Vercel Serverless Function — OCR Ticket Scanner
// Accepts a base64 image of a printed order ticket, sends it to OpenAI GPT-4o vision,
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
  // Square
  '9110':  'cdr_maiz',
};

// Reverse map for the AI prompt (so it knows all valid codes)
const VALID_CODES = Object.keys(TICKET_MAP);

const SYSTEM_PROMPT = `You are an OCR assistant for a bakery order system. You will receive a photo of a printed paper order ticket.

EXTRACT ONLY the product rows from the table. Each row has: CODE, DESCRIPTION, QUANTITY.

RULES:
1. Only extract rows that have a product CODE and a QUANTITY value.
2. IGNORE all of these: headers, "Total Boxes", "Total Units", "Credit Units", "Subtotal", "Credit", "Total", "Payment", "Balance", handwritten dates, route numbers, page numbers, and any text outside the product table.
3. If a quantity is blank, 0, or crossed out, SKIP that row entirely.
4. Quantities are handwritten numbers. Common values: 0.5, 1, 1.5, 2, 3. Read them carefully.
5. If you cannot confidently read a quantity, set "confident" to false.
6. The CODE may have a letter suffix like "S" (e.g., 9226S). Include the suffix.

VALID PRODUCT CODES: ${VALID_CODES.join(', ')}

Return ONLY a JSON array. No markdown, no explanation. Format:
[
  { "code": "9226S", "qty": 1, "description": "Birthday Cake (Small) - Dulce de Leche", "confident": true },
  { "code": "9776", "qty": 0.5, "description": "Cake Slice Pineapple - 12PK", "confident": true }
]

If the image is not a bakery order ticket, return: []`;

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
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error('OPENAI_API_KEY not set');
    return res.status(500).json({ success: false, message: 'Scanner not configured.' });
  }

  // Validate request body
  const { image } = req.body || {};
  if (!image || typeof image !== 'string') {
    return res.status(400).json({ success: false, message: 'No image provided.' });
  }

  // Ensure it's a valid base64 data URL or raw base64
  const isDataUrl = image.startsWith('data:image/');
  const imageContent = isDataUrl ? image : `data:image/jpeg;base64,${image}`;

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Read this bakery order ticket and extract all product codes and quantities.' },
              { type: 'image_url', image_url: { url: imageContent, detail: 'high' } },
            ],
          },
        ],
        max_tokens: 1500,
        temperature: 0,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('OpenAI API error:', response.status, errText);
      return res.status(502).json({ success: false, message: 'AI service error. Please try again.' });
    }

    const data = await response.json();
    const rawContent = data.choices?.[0]?.message?.content || '[]';

    // Parse the JSON from the AI response (strip markdown fences if present)
    let items;
    try {
      const cleaned = rawContent.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      items = JSON.parse(cleaned);
    } catch (parseErr) {
      console.error('Failed to parse AI response:', rawContent);
      return res.status(500).json({ success: false, message: 'Could not parse scan results.' });
    }

    if (!Array.isArray(items)) {
      return res.status(500).json({ success: false, message: 'Invalid scan result format.' });
    }

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

    return res.status(200).json({
      success: true,
      items: mapped,
      total: mapped.length,
      matched: mapped.filter(m => m.matched).length,
      unmatched: mapped.filter(m => !m.matched).length,
    });

  } catch (err) {
    console.error('Scan ticket error:', err);
    return res.status(502).json({ success: false, message: 'Could not reach AI service.' });
  }
}
