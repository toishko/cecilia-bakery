# STAFF FROST PACKER — Live Grid Redesign

> Rebuild the broken Frosted Box Packer on the Staff Portal with a premium Live Grid visualization.  
> The tool helps staff pack frosted cake pieces (4 flavors) into physical boxes that hold exactly 56 pieces (8 lines × 7 pieces per line).

---

## Overview

The Frosted Box Packer is a specialized tool inside the Staff Portal (`staff.html`) that allows the packaging team to visually plan how to fill frosted-piece boxes for driver orders. Each physical box holds 56 pieces arranged in 8 lines of 7. Staff allocate pieces from 4 frosted flavors (Guava, Piña, Dulce de Leche, Chocolate) across one or more boxes.

The tool is currently **broken** due to an ID mismatch introduced during the archived-orders refactor. The HTML template uses `fp-boxes-` / `fp-items-` prefixes, but the JavaScript render functions look for `frost-boxes-` / `frost-left-` / `frost-summary-` prefixes. The packer initializes in memory but never attaches to the DOM.

While fixing it, we are also redesigning the visualization to use a **Live Grid** — an 8×7 CSS grid where cells visually fill with flavor colors as staff type quantities, providing a satisfying, tactile packing experience.

---

## Checklist

### Phase 1: Fix the Breakage
- [ ] Unify all frost packer element IDs to `frost-` prefix consistently
  - `fp-${order.id}` → `frost-container-${order.id}`
  - `fp-items-${order.id}` → `frost-items-${order.id}`
  - `fp-boxes-${order.id}` → `frost-boxes-${order.id}`

### Phase 2: Live Grid CSS
- [ ] Create `.frost-grid` — 8×7 CSS Grid layout (56 cells)
- [ ] Create `.frost-grid-cell` — subtle glass squares with dashed border when empty
- [ ] Create `.frost-grid-cell.filled` — cells fill with flavor color via pop animation
- [ ] Create `.frost-box-card.secured` — green border + ✓ SECURED badge when box hits 56
- [ ] Create `.frost-pill-dock` — horizontal flex row of To-Pack pills
- [ ] Create `.frost-pill` / `.frost-pill.done` — live countdown pills with green checkmark on completion
- [ ] Ensure all frost inputs are 16px to prevent iOS zoom

### Phase 3: HTML Template Redesign
- [ ] Redesign frost packer container template with pill dock + grid + flavor inputs
- [ ] Each box card shows: grid visualization on top, flavor inputs below, total at bottom
- [ ] Add Box button remains at bottom

### Phase 4: JavaScript Render Updates
- [ ] Rewrite `frostRenderBoxes()` to generate Live Grid cells filled by flavor
- [ ] Rewrite `frostUpdateRemaining()` to update Pill Dock counts + done states
- [ ] Expand `FROST_COLORS` to include glow colors for grid cell shadows
- [ ] Keep all existing logic intact: state management, capping, save/restore

### Phase 5: Verification
- [ ] Browser test: expand order with frosted items → grid appears with 56 empty cells
- [ ] Type values → cells pop in with correct colors
- [ ] Hit exactly 56 → ✓ SECURED animation
- [ ] Pill dock counts down correctly
- [ ] Add second box → fresh empty grid
- [ ] Collapse/re-expand card → state persists from localStorage
- [ ] Commit and push to `improvements`

---

## Notes & Decisions

- **No Auto-Fill:** We intentionally do not include an auto-fill/auto-pack feature. Each driver has a specific route-based packing order tied to the day of the week. Generic algorithmic packing would be wrong. Future consideration: "Route Memory" that remembers a driver's box configuration per weekday.
- **Grid dimensions:** 8 rows × 7 columns = 56 cells. This matches the physical box layout exactly (8 lines of 7 pieces).
- **Box capacity:** Hard-capped at 56 pieces per box. Overfill is prevented at the input level.
- **Flavor capping:** Each flavor's total across ALL boxes cannot exceed the ordered quantity.
- **Colors:** Guava = Red (#e74c3c), Piña = Gold (#f39c12), Dulce de Leche = Brown (#8e6f47), Chocolate = Dark Brown (#5c3317).
