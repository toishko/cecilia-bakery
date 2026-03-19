# 🚀 PRE-PUBLISH LOCKDOWN: "COMING SOON" PLAN

This document outlines the temporary restrictions applied to the site before publishing to the domain, and the steps required to restore full functionality later.

---

## 🛠️ Phase 1: Lockdown (Pre-Launch)
*Goal: Prevent users from triggering half-finished features (Chat & Checkout) while maintaining a premium feel.*

### 1.1 Chatbot Intervention
- [ ] **UI Update**: Append `(Coming Soon)` to `data-en` and `(Próximamente)` to `data-es` for all "Custom Cake Order" and "Chat & Order" buttons in `index.html` and `menu.html`.
- [ ] **Logic Intercept**: Modify the `_openChat()` function to trigger a `swal` (SweetAlert) popup instead of opening the chat overlay. 
  - *Message (EN):* "Our Chat Assistant is currently being baked! 🧁 For now, please call us at (201) 869-7633 or visit our store."
  - *Message (ES):* "¡Nuestro Asistente de Chat se está horneando! 🧁 Por ahora, llámanos al (201) 869-7633 o visítanos en la tienda."
- [ ] **FAB Lockdown**: Add a "Coming Soon" hover hint to the floating chat icon.

### 1.2 Checkout Intervention
- [ ] **Button Update**: Update `cartI18n` in `menu.html` to change "Checkout" label to "Checkout (Coming Soon)".
- [ ] **Logic Intercept**: Modify `cartCheckout()` in `menu.html` to intercept the process.
  - *Message (EN):* "Online ordering is coming soon! 🥖 Please visit us at 6101 Park Ave, West New York, NJ to place your order."
  - *Message (ES):* "¡Los pedidos en línea estarán disponibles pronto! 🥖 Visítanos en 6101 Park Ave, West New York, NJ para hacer tu pedido."
- [ ] **Form Disabling**: Ensure the checkout confirmation modal cannot be reached.

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

---

## 📝 Check-off Table (Current Task)

- [x] Modify `menu.html` Translations (Checkout Coming Soon)
- [x] Modify `menu.html` `cartCheckout()` logic
- [x] Modify `menu.html` `_openChat()` logic
- [x] Modify `index.html` `openChat()` logic
- [x] Update button attributes in both files
