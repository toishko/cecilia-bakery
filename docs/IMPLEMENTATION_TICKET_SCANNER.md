# TICKET SCANNER — OCR Auto-Fill for Paper Order Tickets

> Allows admins to photograph a driver's printed order ticket and have it auto-fill the New Order form via AI vision. Designed primarily for one specific driver who uses pre-printed paper tickets.

---

## Overview

One driver submits orders via pre-printed paper tickets (with codes like 9226S, 9745, 9970 and handwritten quantities). Currently these are manually keyed in. This feature adds a "Scan Ticket" button to the New Order form that:

1. Opens the device camera or file picker
2. Sends the image to an AI vision model via a Vercel API route
3. Receives structured JSON of product codes + quantities
4. Cross-references against the in-app product catalog
5. Auto-fills the form — admin reviews and submits

## Architecture

```
[Camera/Upload] → [Frontend JS] → [POST /api/scan-ticket] → [AI Vision API] → [JSON Response]
                                                                                      ↓
                                                              [Frontend matches to catalog → fills form]
```

No new database tables needed. No n8n. One Vercel serverless function.

## Checklist

### Phase 1: API Route ✅
- [x] Create `/api/scan-ticket.js` Vercel serverless function
- [x] Accept base64 image in POST body
- [x] Send to AI vision model (OpenAI GPT-4o)
- [x] Engineered prompt: describes exact ticket layout, column positions, handwriting patterns
- [x] Force structured JSON output format
- [x] Rate limit (5 scans/min per IP)
- [x] Origin validation (reuse pattern from place-order.js)

### Phase 2: Ticket-to-Catalog Mapping ✅
- [x] Build a mapping table inside the API (31 confirmed codes)
- [x] Include mapping in the API so AI returns system keys alongside raw codes
- [x] Fallback: if AI sees an unknown code, return it as unmatched for manual review
- [x] All mappings confirmed with user — see `docs/NOTES_PRODUCT_CATALOG.md` for definitive list

### Phase 3: Frontend UI ✅
- [x] Add a "📷 Scan Ticket" button in the New Order form (appears after driver is selected)
- [x] Mobile: opens device camera; Desktop: opens file picker
- [x] Show loading spinner while processing
- [x] On success: auto-fill product quantities in the form
- [x] Highlight scanned items in green, uncertain items in yellow for manual review
- [ ] Show a small thumbnail of the scanned ticket for reference
- [x] Never auto-submit — admin always reviews first
- [x] "Clear" button to reset all scanned quantities and highlights

### Phase 4: Polish
- [ ] Success/error toast notifications
- [ ] Optional: attach the ticket image to the order record (Supabase Storage)

## Quantity Rules (confirmed 2026-04-19)

| Product Type | What qty means | Valid values |
|---|---|---|
| Birthday Cakes (all HB small & large) | 1 = one whole cake | Whole numbers only: 1, 2, 3... |
| Everything else (frosted, pieces, tres leche, family, square) | 1 = one dozen (12pk), 0.5 = half dozen | 0.5 increments: 0.5, 1, 1.5, 2... |

The AI reads the number exactly as written — no conversion or multiplication.

## API Key Requirement

- OpenAI API key (for GPT-4o vision)
- Stored as `OPENAI_API_KEY` in Vercel env variables (never in code)
- Approximate cost: ~$0.01–0.03 per scan

## Notes & Decisions

- 2026-04-19: Initial implementation with 25 confirmed ticket codes
- 2026-04-19: Added 6 more codes (HB large: 9165/9172/9189, square: 9103/9202, family: 9011) — total 31
- 2026-04-19: Major prompt overhaul for consistency — describes exact ticket layout (columns, where handwritten qty appears), tells AI to scan ALL rows not just valid codes, adds handwriting pattern hints
- 2026-04-19: Increased max_tokens from 1500 to 3000 for larger tickets
- 2026-04-19: **CRITICAL FIX** — Scanner now converts ticket qty to individual pieces before filling form. Birthday cakes (`hb_*`) stay as-is (1=1 cake). Everything else gets ×12 (0.5=6 pieces, 1=12 pieces). The form's parseInt and +/- by 1 is correct since it counts individual pieces.
- The ticket codes (9226S, 9745, etc.) are printed — very OCR-friendly
- Handwritten quantities are simple numbers (0.5, 1, 1.5, 2) — but camera angle/lighting affects accuracy
- Multi-page tickets: user can scan each page separately, quantities accumulate
- This is designed for one driver's workflow but the button is available whenever any driver is selected
