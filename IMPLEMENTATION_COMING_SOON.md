# 🚀 PRE-PUBLISH LOCKDOWN: "COMING SOON" PLAN

This document outlines the temporary restrictions applied to the site before publishing to the domain, and the steps required to restore full functionality later.

---

## 🛠️ Phase 1: Lockdown (Pre-Launch)
*Goal: Prevent users from triggering half-finished features (Chat & Checkout) while maintaining a premium feel.*

### 1.1 Chatbot Intervention
- [x] **UI Update**: Append `(Coming Soon)` to `data-en` and `(Próximamente)` to `data-es` for all "Custom Cake Order" and "Chat & Order" buttons in `index.html` and `menu.html`.
- [x] **Logic Intercept**: Modify the `_openChat()` function to trigger a `swal` (SweetAlert) popup instead of opening the chat overlay. 
  - *Message (EN):* "Our Chat Assistant is currently being baked! 🧁 For now, please call us at (201) 869-7633 or visit our store."
  - *Message (ES):* "¡Nuestro Asistente de Chat se está horneando! 🧁 Por ahora, llámanos al (201) 869-7633 o visítanos en la tienda."
- [x] **FAB Lockdown**: Add a "Coming Soon" hover hint to the floating chat icon.

### 1.2 Checkout Intervention
- [x] **Button Update**: Update `cartI18n` in `menu.html` to change "Checkout" label to "Checkout (Coming Soon)".
- [x] **Logic Intercept**: Modify `cartCheckout()` in `menu.html` to intercept the process.
  - *Message (EN):* "Online ordering is coming soon! 🥖 Please visit us at 6101 Park Ave, West New York, NJ to place your order."
  - *Message (ES):* "¡Los pedidos en línea estarán disponibles pronto! 🥖 Visítanos en 6101 Park Ave, West New York, NJ para hacer tu pedido."
- [x] **Form Disabling**: Ensure the checkout confirmation modal cannot be reached.

### 1.3 Authentication / Portal Lockdown
- [x] **Hide Header Login**: Comment out or set `display: none` on the "Sign In" button in the main navigation.
- [x] **Hide Footer Portals**: Hide the "Portals" / "For the Team" section in the footer.
- [x] **Disable Auth Toggling**: Stop `auth-state.js` from showing the user dropdown or login button until public launch.

---

## 🔓 Phase 2: Restoration (Post-Launch)
*Goal: Bring features back online once backend/payment systems are ready.*

### 2.1 Restoring the Chatbot
1. **Revert `_openChat()`**: Remove the SweetAlert interception code to allow the class `.classList.add('open')` to trigger on the overlay.
2. **Clean UI Labels**: Search and replace `(Coming Soon)` and `(Próximamente)` strings in the HTML button attributes.
3. **Internal Test**: Verify the Supabase/Edge function connection for the AI bot is active before removing the lockdown.

### 2.2 Restoring Checkout & Payments
1. **Revert `cartCheckout()`**: Restore the call to `showConfirm(...)` and the subsequent `_placeOrder` function.
2. **Update Labels**: Set `cartI18n` strings back to "Checkout" and "Pagar".
3. **Integration Point**: This is where the Stripe/Square checkout redirect or the Supabase `orders` table insertion logic will be fully enabled.

### 2.3 Restoring Authentication & Portals
1. **Show Header Login**: Restore visibility of the "Sign In" button in the header.
2. **Restore Footer Links**: Un-hide the "Portals" / "For the Team" footer section.
3. **Re-enable Auth Logic**: Re-activate the full `auth-state.js` logic to handle user sessions and profile menus.

---

## 📝 Phase 1: Lockdown Check-off Table (Completed)

- [x] Modify `menu.html` Translations (Checkout Coming Soon)
- [x] Modify `menu.html` `cartCheckout()` logic
- [x] Modify `menu.html` `_openChat()` logic
- [x] Modify `index.html` `openChat()` logic
- [x] Update button attributes in both files
- [x] Hide Header Login & Footer Portals
- [x] Disable Auth Logic intervention

---

## 📝 Phase 2: Restoration Check-off Table (Current Task)

**Restoring the Chatbot**
- [x] Revert `menu.html` `_openChat()` logic (Remove SweetAlert, restore chat overlay toggle)
- [x] Revert `index.html` `openChat()` logic (Remove SweetAlert, restore chat overlay toggle)
- [x] Clean button attributes in both files (Remove `(Coming Soon)` / `(Próximamente)` from `data-en` and `data-es`)
- [x] Remove "Coming Soon" hover hints from the FAB (Floating Action Button)
- [x] Verify Supabase/Edge function connection for the AI bot

**Restoring Checkout & Payments**
- [x] Revert `menu.html` `cartI18n` Translations (Set back to "Checkout" and "Pagar")
- [x] Revert `menu.html` `cartCheckout()` logic (Restore `showConfirm(...)` and `_placeOrder`)
- [ ] Enable Stripe/Square checkout redirect or Supabase `orders` table insertion logic

**Restoring Authentication & Portals**
- [x] Un-hide Header Login (Remove `display: none` from "Sign In" button in main navigation)
- [x] Un-hide Footer Portals (Remove `display: none` from "Portals" / "For the Team" section)
- [x] Re-enable Auth Logic in `auth-state.js` to handle user sessions and profile menus

