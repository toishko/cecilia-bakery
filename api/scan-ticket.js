// Vercel Serverless Function — OCR Ticket Scanner
// Accepts a base64 image of a printed order ticket, sends it to OpenAI GPT-4o vision (detail: high),
// with fallback to Google Gemini models, and returns structured JSON of product keys + quantities.

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

const SYSTEM_PROMPT = `You are an expert OCR vision assistant for a bakery order system. You will receive an image of a bakery order ticket.

There are TWO possible ticket formats. First, determine which format the image is:

═══════════════════════════════════════════════════════════════════════
FORMAT 1: STORE INVOICE / DELIVERY TICKET
═══════════════════════════════════════════════════════════════════════
• Identifiers:
  - Table headers: "CODE" | "DESCRIPTION" | "QUANTITY"
  - Slice descriptions include "- 12PK" (e.g. "Tres Leches Slice - 12PK", "Cake Slice Pineapple - 12PK")
  - Footer contains "Total Boxes: X", "Total Units: Y"
• How to parse:
  - Slices / Pieces ("- 12PK" items): Quantities are in BOXES / PACKS / DOZENS (e.g. 1.5, 1, 0.5, 2).
    Set "qty" to the exact printed number (e.g. 1.5), and set "unit" to "dozen".
  - Birthday Cakes (9172, 9226, 9189, 9165, 9196, 9172S, etc.): Quantities are in individual CAKES / UNITS (e.g. 1, 2, 6).
    Set "unit" to "unidades".
  - Footer totals:
    "total_boxes": extract from "Total Boxes: X" (e.g. 5.0)
    "total_units": extract from "Total Units: Y" (e.g. 0)

═══════════════════════════════════════════════════════════════════════
FORMAT 2: BAKERY PRODUCTION / PICKUP SHEET
═══════════════════════════════════════════════════════════════════════
• Identifiers:
  - Header title: "PARA RECOGER [Date] A LAS [Time]"
  - Table headers: "CÓDIGO" | "PRODUCTO" | "CANTIDAD" (or "CÓDIGO" | "CANTIDAD" | "PRODUCTO")
  - Descriptions DO NOT have "- 12PK" (e.g. "BREAD PUDDING SLICE", "CAKE SLICE CHOCOLATE", "FLAN")
  - Footer contains "TOTAL CAJAS: X", "TOTAL UNIDADES: Y"
• How to parse:
  - ALL items on this sheet are ALREADY in INDIVIDUAL UNITS / PIECES (e.g. 12, 18, 6, 24, 30, 48).
    Set "qty" to the printed number, and set "unit" to "unidades" for ALL rows.
  - Footer totals:
    "total_boxes": extract from "TOTAL CAJAS: X" (e.g. 23.5)
    "total_units": extract from "TOTAL UNIDADES: Y" (e.g. 61)

═══════════════════════════════════════════════════════════════════════
CRITICAL ROW ALIGNMENT RULE (PREVENT VERTICAL DRIFT)
═══════════════════════════════════════════════════════════════════════
• Every table row is a single straight horizontal line across the page.
• The quantity in the middle/right column belongs STRICTLY to the code and product description on that EXACT SAME horizontal line.
• Do NOT mix up or shift numbers between adjacent rows.
• Transcribe each row into "raw_text_transcription" first line-by-line:
  "Row 1: <CODE> | <QTY> | <PRODUCT>"
  "Row 2: <CODE> | <QTY> | <PRODUCT>"

═══════════════════════════════════════════════════════════════════════
HANDWRITTEN GUEST CHECKS & MISSING CODES
═══════════════════════════════════════════════════════════════════════
If the image is a handwritten guest check without printed codes, match items to the closest code:
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
═══════════════════════════════════════════════════════════════════════
MANDATORY MATHEMATICAL SELF-CHECK (DO THIS BEFORE OUTPUTTING JSON):
═══════════════════════════════════════════════════════════════════════
1. Total Boxes Check:
   - For Format 1: Sum the slice/piece box quantities (e.g. 1.5 + 1 + 1 + 1.5 = 5.0).
   - For Format 2: Sum all slice/piece unit quantities and divide by 12 (e.g. 450 / 12 = 37.5).
   - Compare your computed sum against "TOTAL CAJAS" or "Total Boxes" on the ticket.
   - IF THEY DO NOT MATCH (e.g. your sum is 38.0 but ticket says 37.5):
     Re-examine each slice row carefully to find any misread number (especially 6 misread as 12, or 12 misread as 18 due to row proximity) and correct it so your extracted quantities match the printed total!
2. Total Units Check:
   - Sum all birthday cake quantities (codes starting with 9172, 9226, 9189, 9165, 9196, 9172S, etc.).
   - Compare against "TOTAL UNIDADES" or "Total Units".
   - If they do not match, re-examine the birthday cake rows to find and correct any misread quantity.

Output valid JSON only:
{
  "ticket_type": "format_1_store_invoice" | "format_2_pickup_sheet" | "handwritten",
  "raw_text_transcription": "Row 1: 9738 | 1.5 | Tres Leches Slice - 12PK\nRow 2: 9776 | 1 | Cake Slice Pineapple - 12PK\n...",
  "items": [
    { "code": "9738", "qty": 1.5, "unit": "dozen", "description": "Tres Leches Slice - 12PK", "confident": true },
    { "code": "9776", "qty": 1, "unit": "dozen", "description": "Cake Slice Pineapple - 12PK", "confident": true }
  ],
  "total_boxes": 5.0,
  "total_units": 0
}

If the image is not an order ticket, return: { "ticket_type": null, "raw_text_transcription": "", "items": [], "total_boxes": null, "total_units": null }`;


export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  // Origin check (allow bypass for iOS Shortcut client)
  const origin = req.headers?.['origin'] || req.headers?.['referer'] || '';
  const isShortcut = req.headers?.['x-client'] === 'shortcut' || req.query?.client === 'shortcut';

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

  // Validate API keys
  const openaiKey = process.env.OPENAI_API_KEY;
  const googleKey = process.env.GOOGLE_AI_API_KEY;
  if (!openaiKey && !googleKey) {
    console.error('Neither OPENAI_API_KEY nor GOOGLE_AI_API_KEY is configured');
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
    const imageUrl = isDataUrl ? image : `data:${mimeType};base64,${rawBase64}`;

    let response = null;
    let rawContent = null;
    let lastError = '';

    // ── Primary Engine: OpenAI GPT-4o Latest Vision Snapshot (High Detail) ──
    if (openaiKey) {
      try {
        console.log('Scanning ticket with OpenAI GPT-4o (gpt-4o-2024-11-20, detail: high)...');
        const oaiRes = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${openaiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'gpt-4o-2024-11-20',
            messages: [
              { role: 'system', content: SYSTEM_PROMPT },
              {
                role: 'user',
                content: [
                  {
                    type: 'text',
                    text: 'Read this bakery order ticket image carefully and extract all product codes, quantities, and totals row by row.',
                  },
                  {
                    type: 'image_url',
                    image_url: {
                      url: imageUrl,
                      detail: 'high',
                    },
                  },
                ],
              },
            ],
            temperature: 0,
            max_tokens: 3000,
            response_format: { type: 'json_object' },
          }),
        });

        if (oaiRes.ok) {
          const oaiData = await oaiRes.json();
          rawContent = oaiData.choices?.[0]?.message?.content || '{}';
          response = oaiRes;
        } else {
          const errText = await oaiRes.text();
          console.error('OpenAI GPT-4o error:', oaiRes.status, errText);
          lastError = errText;
        }
      } catch (oaiErr) {
        console.error('OpenAI GPT-4o call exception:', oaiErr);
        lastError = oaiErr.message;
      }
    }

    // ── Fallback Engine: Google Gemini ──
    if (!rawContent && googleKey) {
      console.log('OpenAI failed or not configured. Trying Google Gemini fallback...');
      const MODELS = [
        { name: 'gemini-1.5-pro', api: 'v1beta' },
        { name: 'gemini-2.0-flash', api: 'v1beta' },
        { name: 'gemini-1.5-flash', api: 'v1beta' },
      ];

      for (const model of MODELS) {
        try {
          const requestBody = JSON.stringify({
            contents: [{
              parts: [
                { text: SYSTEM_PROMPT + '\n\nRead this bakery order ticket carefully and extract all product codes, quantities, and totals row by row.' },
                { inlineData: { mimeType, data: rawBase64 } },
              ],
            }],
            generationConfig: {
              temperature: 0,
              maxOutputTokens: 3000,
            },
          });

          const url = `https://generativelanguage.googleapis.com/${model.api}/models/${model.name}:generateContent?key=${googleKey}`;
          const gRes = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: requestBody,
          });

          if (gRes.ok) {
            const data = await gRes.json();
            const parts = data.candidates?.[0]?.content?.parts || [];
            const textParts = parts.filter(p => p.text && !p.thought);
            rawContent = textParts.map(p => p.text).join('') || '{}';
            response = gRes;
            break;
          } else {
            const errText = await gRes.text();
            console.error(`Gemini ${model.name} error:`, gRes.status, errText);
            lastError = errText;
            if (gRes.status === 401 || gRes.status === 403) break;
          }
        } catch (gErr) {
          console.error(`Gemini ${model.name} exception:`, gErr);
          lastError = gErr.message;
        }
      }
    }

    // ── Tertiary Fallback: OpenAI GPT-4o-mini ──
    if (!rawContent && openaiKey) {
      console.log('Attempting secondary fallback to GPT-4o-mini...');
      try {
        const miniRes = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${openaiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'gpt-4o-mini',
            messages: [
              { role: 'system', content: SYSTEM_PROMPT },
              {
                role: 'user',
                content: [
                  { type: 'text', text: 'Read this bakery order ticket image and extract all product codes and quantities.' },
                  { type: 'image_url', image_url: { url: imageUrl, detail: 'high' } },
                ],
              },
            ],
            temperature: 0,
            max_tokens: 3000,
            response_format: { type: 'json_object' },
          }),
        });
        if (miniRes.ok) {
          const miniData = await miniRes.json();
          rawContent = miniData.choices?.[0]?.message?.content || '{}';
          response = miniRes;
        }
      } catch (miniErr) {
        console.error('gpt-4o-mini fallback error:', miniErr);
      }
    }

    if (!rawContent) {
      const status = response ? response.status : 502;
      let errMsg = lastError;
      try {
        const parsed = JSON.parse(lastError);
        errMsg = parsed.error?.message || lastError;
      } catch {}
      errMsg = (errMsg || '').replace(/key=[^&"'\s]+/gi, 'key=HIDDEN');

      const isQuota = status === 429
        || errMsg.includes('insufficient_quota')
        || errMsg.includes('RESOURCE_EXHAUSTED')
        || errMsg.toLowerCase().includes('quota exceeded')
        || errMsg.toLowerCase().includes('rate limit');

      if (isQuota) {
        return sendError('AI scanner rate limit reached or quota exceeded. Please check API quota.', 429);
      }

      const shortErr = errMsg.length > 150 ? errMsg.substring(0, 150) + '...' : errMsg;
      return sendError(`AI scanner service unavailable (${status}: ${shortErr || 'Unknown error'})`, 502);
    }

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
        const diffBoxes = Math.round((roundedComputed - roundedTicket) * 10) / 10;
        const diffPieces = Math.round(diffBoxes * 12);
        const sign = diffBoxes > 0 ? '+' : '';
        mismatch = {
          type: 'total_boxes',
          expected: roundedTicket,
          computed: roundedComputed,
          diff: diffBoxes,
          diff_boxes: diffBoxes,
          diff_pieces: diffPieces,
          detail: `${sign}${diffBoxes} box (${sign}${diffPieces} pcs)`,
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
        const diffUnits = Math.round((roundedComputed - roundedTicket) * 10) / 10;
        const sign = diffUnits > 0 ? '+' : '';
        mismatch = {
          type: 'total_units',
          expected: roundedTicket,
          computed: roundedComputed,
          diff: diffUnits,
          diff_units: diffUnits,
          detail: `${sign}${diffUnits} units`,
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
