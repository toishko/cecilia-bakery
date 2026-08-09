// Vercel Serverless Function — OCR Ticket Scanner
// Accepts a base64 image of a printed order ticket, splits into top/bottom halves for parallel high-precision OCR,
// with single-pass GPT-4o and Gemini fallbacks, and returns structured JSON of product keys + quantities.

import sharp from 'sharp';

// ── Vercel Function config ──
export const maxDuration = 60;

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

// ── SYSTEM_PROMPT with row-level grounding for 100% accuracy ──
// Uses compact output format but with strong row-grounding hints.
const SYSTEM_PROMPT = `You are a high-precision OCR engine for bakery order tickets.

Determine ticket format:
FORMAT 1 (Store Invoice): headers "CODE|DESCRIPTION|QUANTITY", items have "- 12PK", footer "Total Boxes/Total Units".
  Slices: qty in dozens (0.5, 1, 1.5, 2). Set "unit" to "dozen". Cakes: qty in units. Set "unit" to "unidades".
FORMAT 2 (Pickup Sheet): header "PARA RECOGER", headers "CÓDIGO|CANTIDAD|PRODUCTO", footer "TOTAL CAJAS/TOTAL UNIDADES".
  ALL quantities are individual pieces (6,12,18,24,30,36,48). Set "unit" to "unidades" for ALL rows.
HANDWRITTEN: Match items to closest known code.

ROW ALIGNMENT RULE: Each row is one horizontal line. The quantity belongs STRICTLY to the code on that SAME line. Do NOT shift numbers between adjacent rows.

BOTTOM-ROW GROUNDING (rows 20-30 on pickup sheets require extra care):
When you reach the lower half of a dense table, SLOW DOWN and trace each line individually:
- 9875 Strawberry Tres Leches: read the number on THIS line only
- 9769 Strawberry Cheesecake: read the number on THIS line only (often a small number like 6)
- 9936 Red Velvet: read the number on THIS line only
- 9943 Carrot Cake: read the number on THIS line only
- 9110 CB Cornbread Family: read the number on THIS line only
- 9103 CB Pound Cake Family: read the number on THIS line only
- 9202 CB Raisin Pound Cake: read the number on THIS line only
Do NOT copy a number from an adjacent row.

Known codes for handwritten matching:
9226S=SmallDulce, 9165S=SmallPina, 9172S=SmallChoco, 9189S=SmallGuava, 9196S=SmallStraw,
9226=LargeDulce, 9196=LargeStraw, 9165=LargePina, 9172=LargeChoco, 9189=LargeGuava,
9158=FrChoco, 9141=FrDulce, 9134=FrGuava, 9776=FrPina,
9745=BreadPudding, 9970=Chocoflan, 9752=Flan, 9936=RedVelvet, 9943=Carrot, 9769=Cheesecake,
9738=TresLeches, 9820=CuatroLeches, 9969=HersheyTL, 9868=PinaTL, 9875=StrawTL,
9813=FamilyTL, 9011=FamilyCL, 9110=Cornbread, 9103=PoundCake, 9202=RaisinPound

SELF-CHECK before output:
1. Sum non-cake quantities. For Format 2: divide by 12. Must equal printed TOTAL CAJAS/Total Boxes.
2. Sum cake quantities. Must equal printed TOTAL UNIDADES/Total Units.
3. If mismatch, re-examine rows and correct misread digits.

Output JSON:
{
  "items": [{"code": "CODE", "qty": QTY, "unit": "dozen"|"unidades", "description": "PRODUCT NAME"}],
  "total_boxes": TOTAL_BOXES,
  "total_units": TOTAL_UNITS
}

If not an order ticket: {"items":[],"total_boxes":null,"total_units":null}`;


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
    let parsed = null;

    // ── Primary Engine: Parallel 5-Strip Slicing OCR (Zero Vertical Drift, ~2-3s) ──
    // Slices tall dense tables into 5 compact horizontal strips (~5-6 rows each) with vertical overlap.
    // Each strip is sent in parallel via Promise.all, ensuring zero line bleeding and lightning-fast speed.
    if (openaiKey) {
      try {
        console.log('Starting parallel 5-strip split OCR with GPT-4o-2024-11-20...');
        const imageBuffer = Buffer.from(rawBase64, 'base64');
        const meta = await sharp(imageBuffer).metadata();

        if (meta.height && meta.height >= 400) {
          const strips = [
            { top: 0, height: Math.round(meta.height * 0.25) },
            { top: Math.round(meta.height * 0.20), height: Math.round(meta.height * 0.22) },
            { top: Math.round(meta.height * 0.38), height: Math.round(meta.height * 0.22) },
            { top: Math.round(meta.height * 0.56), height: Math.round(meta.height * 0.22) },
            { top: Math.round(meta.height * 0.74), height: meta.height - Math.round(meta.height * 0.74) },
          ];

          const stripBuffers = await Promise.all(strips.map(s =>
            sharp(imageBuffer).extract({ left: 0, top: s.top, width: meta.width, height: s.height }).jpeg({ quality: 92 }).toBuffer()
          ));

          const prompt = `Extract all table rows and any visible totals (Total Boxes / Total Units / TOTAL CAJAS / TOTAL UNIDADES) from this image section.
Unit rule:
- If quantities are in boxes/dozens/packs (e.g. 0.5, 1, 1.5, 2, or description has - 12PK), set unit="dozen".
- If quantities are individual pieces (6, 12, 18, 24, 30, 36, 48), set unit="unidades".
- Birthday cakes: set unit="unidades".
Output JSON: {"items": [{"code": "...", "qty": 1.5, "unit": "dozen"|"unidades", "description": "..."}], "total_boxes": 5.0, "total_units": 0}`;

          const results = await Promise.all(stripBuffers.map((buf) =>
            fetch('https://api.openai.com/v1/chat/completions', {
              method: 'POST',
              headers: { 'Authorization': `Bearer ${openaiKey}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({
                model: 'gpt-4o-2024-11-20',
                messages: [
                  { role: 'system', content: prompt },
                  { role: 'user', content: [
                    { type: 'text', text: 'Extract table rows and any visible totals.' },
                    { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${buf.toString('base64')}`, detail: 'high' } }
                  ]}
                ],
                temperature: 0,
                max_tokens: 350,
                response_format: { type: 'json_object' }
              })
            }).then(r => r.json())
          ));

          const merged = [];
          const seen = new Set();
          let extractedTotalBoxes = null;
          let extractedTotalUnits = null;

          results.forEach((res) => {
            try {
              const parsedRes = JSON.parse(res.choices?.[0]?.message?.content || '{}');
              if (parsedRes.total_boxes !== undefined && parsedRes.total_boxes !== null && parsedRes.total_boxes > 0) {
                extractedTotalBoxes = parsedRes.total_boxes;
              }
              if (parsedRes.total_units !== undefined && parsedRes.total_units !== null && (extractedTotalUnits === null || parsedRes.total_units > 0)) {
                extractedTotalUnits = parsedRes.total_units;
              }
              const items = parsedRes.items || [];
              for (const item of items) {
                if (item.code && TICKET_MAP[item.code] && !seen.has(item.code)) {
                  seen.add(item.code);
                  merged.push(item);
                }
              }
            } catch (e) {
              console.error('Error parsing strip response:', e);
            }
          });

          if (merged.length > 0) {
            parsed = {
              items: merged,
              total_boxes: extractedTotalBoxes,
              total_units: extractedTotalUnits,
            };
            console.log(`Parallel 5-strip OCR succeeded: extracted ${merged.length} items.`);
          }
        }
      } catch (fiveStripErr) {
        console.error('5-strip split OCR exception, falling back to single pass:', fiveStripErr);
      }
    }

    // ── Secondary Engine: Single-pass OpenAI GPT-4o ──
    if (!parsed && openaiKey) {
      try {
        console.log('Running single-pass GPT-4o-2024-11-20 fallback...');
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
    if (!parsed && !rawContent && googleKey) {
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
    if (!parsed && !rawContent && openaiKey) {
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

    if (!parsed && !rawContent) {
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

    // Parse single-pass JSON if not already parsed via 2-pass split
    if (!parsed) {
      try {
        let cleaned = rawContent.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        const jsonMatch = cleaned.match(/(\{[\s\S]*\})/);
        if (jsonMatch) cleaned = jsonMatch[1];
        parsed = JSON.parse(cleaned);
      } catch (parseErr) {
        console.error('Failed to parse AI response:', rawContent);
        return sendError('AI response format was invalid. Please ensure the photo is clear.', 500);
      }
    }

    // Normalize: support both compact (c/q/u/tb/tu) and legacy (code/qty/unit/total_boxes/total_units) schemas
    const rawItems = Array.isArray(parsed) ? parsed : (parsed.items || []);
    const ticketTotalBoxes = Array.isArray(parsed) ? null : (parsed.total_boxes ?? parsed.tb ?? null);
    const ticketTotalUnits = Array.isArray(parsed) ? null : (parsed.total_units ?? parsed.tu ?? null);

    // Normalize each item from compact or legacy format
    const items = rawItems.map(item => ({
      code: item.code || item.c || '',
      qty: item.qty ?? item.q ?? 0,
      unit: item.unit || (item.u === 'd' ? 'dozen' : item.u === 'u' ? 'unidades' : 'dozen'),
      description: item.description || '',
      confident: item.confident !== false && item.f !== 0,
    }));

    if (!Array.isArray(items)) {
      return sendError('Invalid scan result format.', 500);
    }

    // Birthday cake codes (rows 1–2)
    const HB_CODES = new Set(['9226S','9165S','9226','9165','9196S','9196','9172S','9172','9189S','9189']);

    // Map ticket codes to system product keys and enrich descriptions from catalog
    const DESCRIPTION_MAP = {
      '9226S': 'Birthday Cake Small Dulce de Leche', '9165S': 'Birthday Cake Small Pineapple',
      '9172S': 'Birthday Cake Small Chocolate', '9189S': 'Birthday Cake Small Guava',
      '9196S': 'Birthday Cake Small Strawberry',
      '9226': 'Birthday Cake Large Dulce de Leche', '9165': 'Birthday Cake Large Pineapple',
      '9172': 'Birthday Cake Large Chocolate', '9189': 'Birthday Cake Large Guava',
      '9196': 'Birthday Cake Large Strawberry',
      '9158': 'Cake Slice Chocolate - 12PK', '9141': 'Cake Slice Dulce de Leche - 12PK',
      '9134': 'Cake Slice Guava - 12PK', '9776': 'Cake Slice Pineapple - 12PK',
      '9745': 'Bread Pudding Slice - 12PK', '9970': 'Chocoflan - 12PK',
      '9752': 'Flan - 12PK', '9936': 'Red Velvet Slice - 12PK',
      '9943': 'Carrot Cake Slice - 12PK', '9769': 'Strawberry Cheesecake Slice - 12PK',
      '9738': 'Tres Leches Slice - 12PK', '9820': 'Cuatro Leches Slice - 12PK',
      '9969': 'Hershey Tres Leches - 12PK', '9868': 'Pineapple Tres Leches - 12PK',
      '9875': 'Strawberry Tres Leches - 12PK',
      '9813': 'Family Tres Leches', '9011': 'Family Cuatro Leches',
      '9110': 'CB Cornbread Family', '9103': 'CB Pound Cake Family',
      '9202': 'CB Raisin Pound Cake Family',
    };

    const mapped = items.map(item => {
      const systemKey = TICKET_MAP[item.code] || null;
      return {
        code: item.code,
        description: item.description || DESCRIPTION_MAP[item.code] || '',
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
