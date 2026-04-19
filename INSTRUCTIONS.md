# INSTRUCTIONS.md — How We Stay Organized

> **This file is the first thing I read before doing anything.**
> The user will paste this into the chat at the start of every session so I always know the rules.

---

## 1. The Core Rule

**Always check before creating. Always update after completing.**

Before writing a single line of code or creating a new document, I must:
1. Read this file (`INSTRUCTIONS.md`)
2. Scan the MD Registry below to see all existing markdown files
3. Determine if the task is already covered, partially covered, or brand new
4. Act accordingly (see Section 4 — The Update Rules)
5. Only then begin writing code

---

## 2. Naming Convention

All markdown files live in the **`docs/`** folder (`/cecilia-bakery/docs/`) and follow this pattern:

| Prefix | Purpose | Example |
|---|---|---|
| `INSTRUCTIONS.md` | This file. The master rulebook. Lives in the project root. Only one ever exists. | `INSTRUCTIONS.md` |
| `IMPLEMENTATION_futureplans.md` | Long-term feature wishlist & roadmap | `IMPLEMENTATION_futureplans.md` |
| `IMPLEMENTATION_[topic].md` | A focused plan for one specific feature or system | `IMPLEMENTATION_SUPABASE.md` |
| `PROGRESS_[topic].md` | Tracks work in progress and completed steps for a topic | `PROGRESS_hotfixes.md` |
| `NOTES_[topic].md` | Loose ideas, design decisions, or things to revisit later | `NOTES_design.md` |

**Rules:**
- File names are all caps with underscores. No spaces.
- `INSTRUCTIONS.md` always lives in the project root. Everything else goes in `docs/`.
- Never create two files covering the same topic. Merge or update instead.
- When a topic is fully complete, mark it done inside the file — do not delete it.

---

## 3. The Workflow (Before Every Task)

```
START OF EVERY SESSION OR TASK
│
├── 1. Read INSTRUCTIONS.md
├── 2. Check the MD Registry (Section 6 below)
├── 3. Read any relevant NOTES_*.md or IMPLEMENTATION_*.md files to understand context
├── 4. Is the technical topic already in an existing IMPLEMENTATION_*.md or PROGRESS_*.md file?
│     ├── YES, fully covered → Update that file, mark progress
│     ├── YES, partially covered → Edit that file to add the new section
│     └── NO, brand new topic → Create a new MD file using the template (Section 7)
├── 5. Write or update the MD file to reflect what we're about to do
├── 6. Write the code / make the change
└── 7. After the task: update the MD to mark what's done or add new notes
```

---

## 4. The Update Rules

**Edit an existing MD when:**
- We are completing a checklist item that already exists
- We are expanding or adjusting a plan that is already written
- We are correcting something we previously planned but changed direction on

**Create a new MD when:**
- The task is a genuinely new topic not covered in any existing file
- A topic has grown so large it needs its own focused document
- We are starting a new major phase (e.g., analytics, wholesale portal, mobile PWA)

---

## 5. The After-Action Rule

After every task I complete, I must:
- Mark any finished checklist items with `[x]` in the relevant MD file
- Add any new discoveries, blockers, or decisions as notes at the bottom
- Update the MD Registry in this file if a new MD was created

---

## 6. MD Registry (Always Keep This Updated)

| File | What It Covers | Status |
|---|---|---|
| `INSTRUCTIONS.md` | This rulebook. How to manage all documentation. | ✅ Active |
| `docs/IMPLEMENTATION_ADMIN_DASHBOARD.md` | Admin dashboard: login, order management, payment flow, realtime, settings | ✅ Complete |
| `docs/IMPLEMENTATION_DRIVER_FORM.md` | Driver order submission form: product selection, pricing, submission flow | ✅ Complete |
| `docs/IMPLEMENTATION_DRIVER_MANAGEMENT.md` | Driver accounts: creation, roles, linking to Supabase auth | ✅ Complete |
| `docs/IMPLEMENTATION_DRIVER_RECEIPTS.md` | Driver-facing order history and receipt view | ✅ Complete |
| `docs/IMPLEMENTATION_EXPORT_PRINT.md` | Export and print functionality for orders | ✅ Complete |
| `docs/IMPLEMENTATION_NOTIFICATIONS.md` | Email notifications: admin alerts and customer confirmations | ✅ Complete |
| `docs/IMPLEMENTATION_POLISH.md` | UI polish, micro-animations, premium visual improvements | 🔄 In Progress |
| `docs/IMPLEMENTATION_PUSH_NOTIFICATIONS.md` | Browser push notifications for admins and drivers | ✅ Complete |
| `docs/IMPLEMENTATION_PWA.md` | PWA setup: manifest, service worker, installability | ✅ Complete |
| `docs/IMPLEMENTATION_PWA_IMPROVEMENTS.md` | PWA improvements: offline support, caching strategy | 🔄 In Progress |
| `docs/IMPLEMENTATION_SUPABASE.md` | Supabase schema, RLS, security, role setup | 🔄 Phase B complete — Phase C next |
| `docs/IMPLEMENTATION_BOTTOM_NAV.md` | Mobile bottom tab bar: replaces hamburger dropdown, sub-tab grouping | 🔄 In Progress |
| `docs/IMPLEMENTATION_INSIGHTS.md` | Insights analytics tab: donut charts, driver leaderboard, revenue breakdowns | 🔄 In Progress |
| `docs/IMPLEMENTATION_ORDERS_UI.md` | Orders UI redesign: avatar lists, receipt slide-out sheet, modern filters | 🔄 In Progress |
| `docs/IMPLEMENTATION_NEEDS_ATTENTION.md` | Needs Attention UI refactor: global action queue, slide-out sheet | 🔄 In Progress |
| `docs/IMPLEMENTATION_futureplans.md` | Future features: analytics dashboard, wholesale portal, production tracking | 🔄 Analytics In Progress |

---

## 7. New MD File Template

When creating a brand new MD file, always use this structure:

```markdown
# [TITLE] — [One-line description]

> What this file is for and why it exists.

---

## Overview
Brief plain-English summary of what we are building or planning.

## Checklist
- [ ] Step one
- [ ] Step two
- [ ] Step three

## Notes & Decisions
- Any design decisions, blockers, or things to revisit go here.
- Date decisions if they are important.
```

---

## 8. Branch Strategy

- `main` → production. Only merge when fully tested. Auto-deploys to Vercel.
- `improvements` → active development branch. This is where all new work happens.
- Never commit directly to `main` for new features. Always branch → test → merge.

---

## 9. The Database Rule (Non-Negotiable)

**No SQL runs against any database without explicit user approval.**

The process is always:
1. I write the SQL in a `migrations/` file with every line commented
2. I show it to the user and explain what each step does
3. The user reads it and says **"run it"** explicitly
4. Only then does it execute

**Additional rules:**
- All migration files are numbered sequentially: `001_`, `002_`, `003_`...
- Every migration file must include a header comment naming the client and purpose
- I never run `DROP`, `TRUNCATE`, or `DELETE` on any table without a separate explicit confirmation
- I never touch a schema that does not belong to this project
- 🔴 **NEVER ask for or accept credentials in the chat.** All API keys, tokens, passwords, and secrets go into `.env` only. I read them from the file.
