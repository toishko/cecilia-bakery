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

### Phase 1: API Route
- [x] Create `/api/scan-ticket.js` Vercel serverless function
- [x] Accept base64 image in POST body
- [x] Send to AI vision model (OpenAI GPT-4o)
- [x] Engineered prompt: extract only CODE + QUANTITY from the table, ignore headers/totals/notes
- [x] Force structured JSON output format
- [x] Rate limit (5 scans/min per IP)
- [x] Origin validation (reuse pattern from place-order.js)

### Phase 2: Ticket-to-Catalog Mapping
- [x] Build a mapping table inside the API that maps ticket codes to system product keys
- [x] Include mapping in the API so AI returns system keys alongside raw codes
- [x] Fallback: if AI can't map a code, return the raw code + description for manual matching
  - 9226S → hb_s_dulce (Birthday Cake Small - Dulce de Leche)
  - 9165S → hb_s_pina (Birthday Cake Small - Pineapple)
  - 9745 → pz_pudin (Bread Pudding Slice)
  - 9158 → fr_choco (Cake Slice Chocolate)
  - 9141 → TODO: Cake Slice Dulce de Leche (verify key)
  - 9134 → pz_guava (Cake Slice Guava)
  - 9776 → pz_pina (Cake Slice Pineapple)
  - 9970 → pz_chocoflan (Chocoflan Slice)
  - 9752 → pz_flan (Flan Slice)
  - 9813 → fam_tl (Tres Leches Family)
  - 9738 → tl (Tres Leches Slice)
  - 9820 → cuatro_leche (Cuatro Leches Slice)
  - 9969 → tl_hershey (Hershey Tres Leches Slice)
  - 9868 → tl_pina (Pineapple Tres Leches Slice)
  - 9875 → tl_straw (Strawberry Tres Leches Slice)
  - 9769 → pz_cheese (Strawberry Cheesecake Slice)
  - 9936 → pz_rv (Red Velvet Cake Slice)
  - 9943 → TODO: Carrot Cake Slice (verify key)
  - 9226 → hb_b_dulce (Birthday Cake Large - Dulce de Leche)
  - 9196 → hb_b_straw (Birthday Cake Large - Strawberry)
  - 9172S → hb_s_choco (Birthday Cake Small - Chocolate)
  - 9189S → hb_s_guava (Birthday Cake Small - Guava)
  - 9196S → TODO: Birthday Cake Small - Strawberry (verify key)
  - 9110 → cdr_maiz (CB Cornbread Family Sz)
- [ ] Include mapping in the API prompt so AI returns system keys, not ticket codes
- [ ] Fallback: if AI can't map a code, return the raw code + description for manual matching

### Phase 3: Frontend UI
- [x] Add a "📷 Scan Ticket" button in the New Order form (appears after driver is selected)
- [x] Mobile: opens device camera; Desktop: opens file picker
- [x] Show loading spinner while processing
- [x] On success: auto-fill product quantities in the form
- [x] Highlight any unmatched/uncertain items in yellow for manual review
- [ ] Show a small thumbnail of the scanned ticket for reference
- [x] Never auto-submit — admin always reviews first

### Phase 4: Polish
- [ ] Success/error toast notifications
- [ ] "Clear scan" button to reset filled quantities
- [ ] Optional: attach the ticket image to the order record (Supabase Storage)

## API Key Requirement

- Need an OpenAI API key (for GPT-4o vision) OR use Vercel AI Gateway
- Store as `OPENAI_API_KEY` in Vercel env variables (never in code)
- Approximate cost: ~$0.01–0.03 per scan

## Notes & Decisions

- The ticket codes (9226S, 9745, etc.) are printed — very OCR-friendly
- Handwritten quantities are simple numbers (0.5, 1, 1.5, 2) — low error risk
- The mapping table needs to be verified with the user since some codes aren't in the current catalog
- Multi-page tickets: user can scan each page separately, quantities accumulate
- This is designed for one driver's workflow but the button is available whenever any driver is selected
