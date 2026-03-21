# Cecilia Bakery — Implementation Tracker

## Active Improvements

### 1. Add Logo to Partner & Driver Login Pages
**Status:** ✅ Complete  
**Priority:** High  

The Admin and Staff login pages include the Cecilia Bakery logo (base64-embedded `<img>` inside a styled `<div>`), but the Partner (`partner-login.html`) and Driver (`driver-login.html`) login pages did not.

**Files modified:**
- `partner-login.html` — logo `<div>` added inside `.auth-card` before the heading
- `driver-login.html` — logo `<div>` added inside `.auth-card` before the heading

---

### 2. Differentiate Staff Portal Subtitle
**Status:** ✅ Complete  
**Priority:** Medium  

Both Admin and Staff portals previously shared the same subtitle: **"Internal Bakery Management"**. The Staff portal now has a distinct subtitle.

**Files modified:**
- `staff-login.html` — subtitle changed from "Internal Bakery Management" to "Staff Portal — Team Access"

**Note:** The Admin portal subtitle ("Internal Bakery Management") remains unchanged.

---

### 3. Rename `bulk-orders.html` to `driver-dashboard.html`
**Status:** ✅ Complete  
**Priority:** Medium  

The Driver portal dashboard was handled by `bulk-orders.html`. It has been copied to `driver-dashboard.html` for consistency with other role-based dashboards.

**Files modified:**
- `bulk-orders.html` → copied to `driver-dashboard.html`
- `driver-auth.js` — references updated on lines 20 and 146
- `vite.config.js` — build input entry updated on line 21

---

## Future Improvements (Deferred)

### 4. Add Product Photography to Menu Cards
**Status:** ⬜ Deferred  
**Notes:** Menu page currently uses placeholder/generic images. Real product photos needed.

### 5. Standardize "Return to Bakery" Link Behavior
**Status:** ⬜ Deferred  
**Notes:** Different login pages link to different destinations. Should standardize.

### 6. Add Scroll-to-Top Button on Menu Page
**Status:** ⬜ Deferred  

### 7. Add Alt Text to All Product Images
**Status:** ⬜ Deferred  

---

## Completed

All three active items (1–3) were completed successfully.
