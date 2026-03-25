# Phase 6 — Export, Print & Share

> Available in the admin dashboard Order Detail view.

---

## Print with Totals

### What It Shows
- Driver name, order number, business name, date/time
- Table of all items: Product Name, Qty (or Adjusted Qty), Unit Price, Line Total
- **Grand Total** at bottom
- If admin adjusted quantities: shows adjusted values with note (e.g., "+2 at pickup")
- Payment status + amount paid (if partial)
- Notes (if any)

### Behavior
- Admin clicks "Print" button (with totals toggle ON)
- Opens browser print dialog with a clean, formatted print stylesheet
- No navigation, no buttons — just the order content
- Paper-friendly: black text on white, no dark backgrounds

---

## Print without Totals (Packing Slip)

### What It Shows
- Driver name, order number, business name, date/time
- Table of all items: Product Name, Qty only
- **No prices, no line totals, no grand total**
- Adjusted quantities shown if applicable
- Notes (if any)

### Behavior
- Admin toggles totals OFF → clicks "Print"
- Same clean print view but without any financial data
- Useful for giving to the driver or kitchen staff

---

## PDF Download

### Behavior
- "Download PDF" button in order detail
- Generates a PDF version of the current view (respects totals toggle)
- File name: `Order-1047-Carlos-2026-03-24.pdf`
- Uses browser's built-in print-to-PDF or a lightweight JS PDF library

---

## WhatsApp Share

### Behavior
- "Share via WhatsApp" button in order detail
- Formats the order as a text message:

```
📦 Order #1047
Driver: Carlos
Business: La Tiendita
Date: Mar 24, 2026

Items:
• Redondo Piña Inside × 5
• Tres Leche × 3
• Cheesecake × 2

Total Items: 10
```

- If totals are ON, includes prices + grand total
- If totals are OFF, items + quantities only
- Opens WhatsApp with pre-filled message via `https://wa.me/?text=...`
- Respects current language (EN/ES)

---

## Checklist
- [ ] Print with totals (clean print stylesheet)
- [ ] Print without totals (packing slip)
- [ ] PDF download (respects totals toggle)
- [ ] WhatsApp share (formatted message, respects totals + language)
- [ ] Browser verification for all export methods
