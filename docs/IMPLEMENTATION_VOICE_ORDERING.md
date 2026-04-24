# IMPLEMENTATION_VOICE_ORDERING — AI Push-to-Talk Order Entry

> AI-powered voice ordering for the driver and admin order forms. Drivers hold the mic button, speak their order in natural Spanish/Spanglish, and Gemini AI parses product names + quantities from the bakery's catalog, handles corrections, and reads back the order for confirmation.

---

## Overview

A push-to-talk voice ordering system integrated into the New Order form for both drivers and admins. The existing bottom-nav `+` FAB transforms into a mic icon when on the New Order screen. Drivers hold the mic to speak, release to process. The AI understands bakery-specific Spanish/Spanglish, fuzzy-matches products from the catalog, handles "dozen" math (×12), supports multi-turn corrections without starting over, and reads back the order aloud in whichever language the driver spoke most.

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
- [ ] Add `voice_order_enabled BOOLEAN DEFAULT false` column to `drivers` table (migration file required — user must approve)

### API
- [ ] Create `/api/voice-order.js` — Vercel serverless function
  - [ ] Accept base64 audio + product catalog + current order + conversation history
  - [ ] System prompt: bakery Spanish, fuzzy matching, dozen ×12, corrections, language detection
  - [ ] Return structured actions JSON + readback in detected language
  - [ ] Rate limiting, origin validation, Gemini model fallback chain

### Admin Dashboard
- [ ] Add "AI Voice Ordering" toggle in driver edit form Permissions section (`admin-dashboard.html`)
- [ ] Read/write `voice_order_enabled` in edit/save handlers (`admin-dashboard.js`)
- [ ] Add voice FAB + overlay + confirmation card to admin New Order form (always visible, no toggle gate)
- [ ] Wire admin voice ordering logic (always enabled)
- [ ] Add voice styles to `admin-dashboard.css`

### Driver Portal
- [x] Transform bottom-nav `+` FAB → mic icon when on New Order screen (`driver-order.html`)
- [x] Add voice tooltip, recording overlay, confirmation card HTML
- [x] Feature flag check: add `voice_order_enabled` to `checkAdvancedFeatures()` (`driver-order.js`)
- [x] Voice ordering engine: MediaRecorder, state machine, API calls, conversation context
- [x] Apply actions to live order form quantities
- [x] TTS readback via SpeechSynthesis in detected language
- [x] Confirmation flow: "Confirm" applies, hold mic again for changes
- [x] Add voice styles to `driver-order.css`
- [ ] **Footer mic redesign**: Move mic FAB into form-footer (center position, between Cancel & Continue)
- [ ] Move item count badge onto Continue button as inline counter ("Continue • 23")

### Polish
- [x] Pulse animation while recording
- [x] Processing spinner state
- [x] Product row highlight animation when voice sets quantities
- [ ] Dark mode support for all voice UI
- [x] Tooltip auto-dismiss after first use
- [ ] Haptic feedback on mobile (if supported)

## Architecture

```
Driver/Admin holds mic FAB
        │
        ▼
MediaRecorder captures audio (webm/opus)
        │
        ▼ base64 audio
POST /api/voice-order
  ├── audio data (inline)
  ├── product catalog [{key, en, es, category}]
  ├── current order state {key: qty}
  ├── conversation history [{role, content}]
  └── lang preference
        │
        ▼
Gemini processes audio + context
  ├── Transcribes speech
  ├── Detects dominant language
  ├── Fuzzy-matches products
  ├── Handles "dozena" (×12)
  ├── Handles corrections ("borra", "ponme", "quítame")
  └── Returns structured JSON
        │
        ▼
Client receives response
  ├── Shows confirmation card with items
  ├── TTS readback in detected language
  ├── User taps "Confirm" → applies to form
  └── User holds mic again → new audio + full context → repeat
```

## Notes & Decisions
- *2026-04-24:* Feature created. Using Gemini for product parsing from text transcripts.
- *2026-04-24:* "Dozena"/"dozen" = multiply by 12. The order form records individual piece quantities.
- *2026-04-24:* Readback language auto-detected from what the driver actually spoke, not from the app language setting.
- *2026-04-24:* Multi-turn conversation — AI remembers context between consecutive interactions within the same order session.
- *2026-04-24:* Footer mic redesign — mic lives in form footer between Cancel and Continue.
- *2026-04-24:* **Conversational flow redesign** — Changed from hold-to-talk with audio upload to tap-to-start with live SpeechRecognition typewriter. Browser handles speech-to-text for live display; Gemini handles product parsing from transcript text. Much faster (no audio upload) and gives real-time visual feedback.
