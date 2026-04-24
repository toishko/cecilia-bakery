# IMPLEMENTATION_VOICE_ORDERING — AI Push-to-Talk Order Entry

> AI-powered voice ordering for the driver and admin order forms. Drivers hold the mic button, speak their order in natural Spanish/Spanglish, and Gemini AI parses product names + quantities from the bakery's catalog, handles corrections, and reads back the order for confirmation.

---

## Overview

A push-to-talk voice ordering system integrated into the New Order form for both drivers and admins. The existing bottom-nav `+` FAB transforms into a mic icon when on the New Order screen. Drivers hold the mic to speak, release to process. The AI understands bakery-specific Spanish/Spanglish, fuzzy-matches products from the catalog, handles "dozen" math (×12), supports multi-turn corrections without starting over, and reads back the order aloud in whichever language the driver spoke most.

**Key design decisions:**
- Uses Google Gemini for both audio transcription AND order parsing in one API call (same key/billing as ticket scanner)
- Audio captured via `MediaRecorder` API (webm/opus) — works on ALL browsers/devices
- Multi-turn conversational loop: hold mic → AI shows parsed order → hold mic again for changes → AI has full context
- Readback language = whichever language the driver spoke most (Spanish, English, or Spanglish)
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
- [ ] Transform bottom-nav `+` FAB → mic icon when on New Order screen (`driver-order.html`)
- [ ] Add voice tooltip, recording overlay, confirmation card HTML
- [ ] Feature flag check: add `voice_order_enabled` to `checkAdvancedFeatures()` (`driver-order.js`)
- [ ] Voice ordering engine: MediaRecorder, state machine, API calls, conversation context
- [ ] Apply actions to live order form quantities
- [ ] TTS readback via SpeechSynthesis in detected language
- [ ] Confirmation flow: "Confirm" applies, hold mic again for changes
- [ ] Add voice styles to `driver-order.css`

### Polish
- [ ] Pulse animation while recording
- [ ] Processing spinner state
- [ ] Product row highlight animation when voice sets quantities
- [ ] Dark mode support for all voice UI
- [ ] Tooltip auto-dismiss after first use
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
- *2026-04-24:* Feature created. Using Gemini audio input (not browser Web Speech API) for reliability across all devices.
- *2026-04-24:* "Dozena"/"dozen" = multiply by 12. The order form records individual piece quantities.
- *2026-04-24:* Readback language auto-detected from what the driver actually spoke, not from the app language setting.
- *2026-04-24:* Multi-turn conversation — AI remembers context between consecutive hold-to-talk interactions within the same order session.
- *2026-04-24:* FAB transforms from `+` to mic on New Order screen (no separate floating button).
