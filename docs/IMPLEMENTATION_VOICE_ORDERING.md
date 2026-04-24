# IMPLEMENTATION_VOICE_ORDERING — AI Conversational Voice Ordering

> AI-powered voice ordering for the driver and admin order forms. Drivers tap the mic button, speak their order naturally in Spanish/Spanglish, see a live typewriter transcript, and Gemini AI parses products + quantities from the bakery's catalog, handles corrections, and reads back the order for confirmation.

---

## Overview

A conversational voice ordering system integrated into the New Order form for drivers. A mic FAB in the form footer opens a full-screen voice panel with live SpeechRecognition typewriter. After the driver pauses speaking (~1.5s), the system asks "Done ordering?" — if yes, the text transcript is sent to Gemini for product parsing. The AI understands bakery-specific Spanish/Spanglish, fuzzy-matches products from the catalog, handles "dozen" math (×12), supports multi-turn corrections, and reads back the order aloud.

**Key design decisions:**
- Tap mic → opens voice screen → SpeechRecognition starts immediately
- Live typewriter shows transcript as driver speaks
- ~1.5s pause → AI asks "Are you done?" — if not, resume listening
- When done, sends text transcript to Gemini for product parsing (not raw audio — faster + cheaper)
- Gemini handles Spanglish fuzzy matching, "dozena" ×12, corrections
- Readback language = whichever language the driver spoke most
- Feature gated per driver via `voice_order_enabled` toggle (same pattern as `scanner_enabled`)
- Always available for admins on the admin dashboard

## Checklist

### Database
- [ ] Add `voice_order_enabled BOOLEAN DEFAULT false` column to `drivers` table (migration `006` written — awaiting user approval to run)

### API
- [x] Create `/api/voice-order.js` — Vercel serverless function
  - [x] Accept text transcript + product catalog + current order + conversation history
  - [x] System prompt: bakery Spanish, fuzzy matching, dozen ×12, corrections, language detection
  - [x] Return structured actions JSON + readback in detected language
  - [x] Rate limiting, origin validation, Gemini model fallback chain (2.5-flash → 2.0-flash → 1.5-flash)

### Admin Dashboard
- [x] Add "AI Voice Ordering" toggle in driver edit form Permissions section (`admin-dashboard.html`)
- [x] Read/write `voice_order_enabled` in edit/save handlers (`admin-dashboard.js`)
- [ ] Add voice screen + confirmation card to admin New Order form (always visible, no toggle gate)
- [ ] Wire admin voice ordering logic (always enabled)
- [ ] Add voice styles to `admin-dashboard.css`

### Driver Portal
- [x] Mic FAB in form-footer (centered between Cancel and Continue)
- [x] Full-screen voice panel: header, transcript area, listening dots, done prompt, processing spinner
- [x] Confirmation card with parsed items
- [x] Feature flag check: `voice_order_enabled` in `checkAdvancedFeatures()` (`driver-order.js`)
- [x] SpeechRecognition engine: live typewriter, pause detection (1.5s), "Done ordering?" prompt
- [x] Gemini API integration: text transcript → parsed order actions
- [x] Apply actions to live order form quantities with highlight animation
- [x] TTS readback via SpeechSynthesis in detected language
- [x] Item count badge on Continue button as inline counter ("Continue • 23")
- [x] Voice overlay pointer-events fix (invisible overlays were blocking bottom nav)
- [x] Voice styles in `driver-order.css`

### Polish
- [x] Listening indicator dots animation
- [x] Slide-in animation for voice screen
- [x] Processing spinner state
- [x] Product row highlight animation when voice sets quantities
- [x] Tooltip auto-dismiss after first use
- [ ] Dark mode contrast verification for all voice UI
- [ ] Haptic feedback on mobile (if supported)

## Architecture

```
Driver taps mic FAB in form footer
        │
        ▼
Full-screen voice panel opens
        │
        ▼ auto-starts
SpeechRecognition (browser API)
  ├── Live typewriter shows words as driver speaks
  ├── Supports continuous + interim results
  └── lang: es-US or en-US based on app language
        │
        ▼ ~1.5s pause detected
"Done ordering?" prompt
  ├── [Keep going] → resume SpeechRecognition
  └── [Yes, process] → send transcript text
        │
        ▼
POST /api/voice-order
  ├── transcript (text string)
  ├── product catalog [{key, en, es, category}]
  ├── current order state {key: qty}
  └── conversation history [{role, content}]
        │
        ▼
Gemini parses text + context
  ├── Detects dominant language
  ├── Fuzzy-matches products
  ├── Handles "dozena" (×12)
  ├── Handles corrections ("borra", "ponme", "quítame")
  └── Returns structured JSON
        │
        ▼
Client receives response
  ├── Shows confirmation card with parsed items
  ├── TTS readback in detected language
  ├── User taps "Confirm" → applies to form
  └── User taps mic again → new session with full context
```

## Notes & Decisions
- *2026-04-24:* Feature created. Using Gemini for product parsing from text transcripts.
- *2026-04-24:* "Dozena"/"dozen" = multiply by 12. The order form records individual piece quantities.
- *2026-04-24:* Readback language auto-detected from what the driver actually spoke, not from the app language setting.
- *2026-04-24:* Multi-turn conversation — AI remembers context between consecutive interactions within the same order session.
- *2026-04-24:* Footer mic redesign — mic lives in form footer between Cancel and Continue.
- *2026-04-24:* **Conversational flow redesign** — Changed from hold-to-talk with audio upload to tap-to-start with live SpeechRecognition typewriter. Browser handles speech-to-text for live display; Gemini handles product parsing from transcript text. Much faster (no audio upload) and gives real-time visual feedback.
