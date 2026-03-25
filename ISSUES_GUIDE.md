# Issues Guide — Standing Rules for Implementation

> Reference this file at the start of every work session.  
> These rules are ALWAYS active. You do NOT need to repeat them.

---

## 1. Always Update the Checklists As You Go

- When you START a task → mark it `[/]` in both the phase doc AND `MASTER_DRIVER_SYSTEM.md`
- When you FINISH a task → mark it `[x]` in both files
- Do this immediately, not at the end of the session
- If you skip or defer something, add a note next to it explaining why

---

## 2. Read Before You Write

Before starting ANY phase or task:
1. **Read the full phase doc** (e.g., `IMPLEMENTATION_DRIVER_FORM.md`) top to bottom
2. **Read `MASTER_DRIVER_SYSTEM.md`** to see what's already done
3. **Read this file** to remind yourself of the rules
4. Only THEN start writing code

---

## 3. Don't Guess — Check

- If you're unsure about a design decision, check the phase doc first
- If the phase doc doesn't cover it, ASK — don't assume
- If you remember something from earlier in the conversation but it's not in the docs, it probably got cut. Follow the docs, not memory

---

## 4. One Phase at a Time

- Only work on the phase the user tells you to work on
- Don't jump ahead to future phases
- Don't retroactively change completed phases without asking
- If you discover a dependency on a future phase, note it and ask how to proceed

---

## 5. Match the Existing Website Theme

Every page you create must use:
- CSS variables from `index.html` (`:root` and `[data-theme="dark"]`)
- Fonts: Cormorant Garamond (headings) + Outfit (body)
- Light/dark mode via `data-theme` attribute
- Glassmorphic style (subtle, not overdone — it's a bakery, keep it warm)
- Lucide icons (already loaded via CDN in the site)

If unsure about a style, reference `index.html` lines 15–130 for the full design token system.

---

## 6. Supabase Connection

- Supabase client is loaded via CDN (`@supabase/supabase-js`)
- The existing site uses `window.__supabase` — follow the same pattern
- Supabase URL and anon key are already in the codebase — reuse them, don't hardcode new ones
- Always check if the Supabase client is initialized before making queries

---

## 7. File References

| File | What it is |
|------|-----------|
| `MASTER_DRIVER_SYSTEM.md` | Master checklist — update as you go |
| `docs/IMPLEMENTATION_*.md` | Detailed specs per phase — your source of truth |
| `ISSUES_GUIDE.md` | This file — standing rules (always active) |
| `index.html` | Reference for design tokens, CSS variables, theme system |
| `vite.config.js` | Must add new HTML pages to build inputs |

---

## 8. When You Hit a Problem

1. **Don't silently work around it** — tell the user what went wrong
2. **Propose a solution** — don't just report the problem
3. **If it's a Supabase issue** — check RLS policies, table structure, and auth state first
4. **If it's a styling issue** — check if you're using the correct CSS variable names from the theme
5. **If it's a data issue** — verify the query against the table schema in `IMPLEMENTATION_SUPABASE.md`

---

## 9. Testing After Every Major Piece

After completing each checklist item:
- Verify it works in the browser
- Test both light and dark mode
- Test in English and Spanish
- Test on mobile viewport (375px width)
- If it involves Supabase, verify the data actually saved/loaded correctly

---

## 10. Don't Break Existing Code

- `index.html` and `menu.html` must NOT be modified (unless explicitly asked)
- New files (`driver-order.html`, `admin-dashboard.html`) are standalone pages
- Shared resources (logo, CSS variables) should be referenced, not duplicated
- If you need to add something to `vite.config.js`, only add new entries — don't change existing ones

---

## 11. How Sessions Will Work

The user will typically say something like:
> "Follow the issues guide. Let's work on [phase]. Here's the implementation doc: [paste or reference]"

When this happens:
1. Read this guide
2. Read the referenced implementation doc
3. Check `MASTER_DRIVER_SYSTEM.md` for current progress
4. Start working, updating checklists as you go
5. When you finish or need to stop, summarize what was completed and what's left

---

## 12. Context Recovery

If you seem to have lost context (new conversation, long session):
- The user may say "read the issues guide" — that means read THIS file
- Then read `MASTER_DRIVER_SYSTEM.md` to see overall progress
- Then read the specific phase doc they want you to work on
- This gives you full context without the user needing to re-explain everything

---

## 13. Naming Conventions

- HTML files: lowercase with hyphens (`driver-order.html`, `admin-dashboard.html`)
- CSS classes: lowercase with hyphens (`.order-card`, `.payment-badge`)
- JS functions: camelCase (`toggleSection`, `submitOrder`)
- Supabase tables: lowercase with underscores (`driver_orders`, `driver_order_items`)
- Product keys: lowercase with underscores (`redondo_inside_pina`)

---

## 14. Language (EN/ES)

- Every user-facing string must have both English and Spanish versions
- Use `data-en` and `data-es` attributes (same pattern as existing site)
- Language state stored in a `lang` variable
- Default: English, unless driver has a saved preference
