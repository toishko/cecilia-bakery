// Vercel Serverless Function — proxies order to n8n webhook
// This avoids CORS issues since the request comes from the server, not the browser.

export default async function handler(req, res) {
  // Only allow POST
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  // Require N8N_WEBHOOK_URL to be set as an environment variable
  const N8N_WEBHOOK_URL = process.env.N8N_WEBHOOK_URL;
  if (!N8N_WEBHOOK_URL) {
    console.error('N8N_WEBHOOK_URL environment variable is not set');
    return res.status(500).json({ success: false, message: 'Payment service not configured.' });
  }

  // ── Server-side input validation ──
  const body = req.body;
  if (!body || typeof body !== 'object') {
    return res.status(400).json({ success: false, message: 'Invalid request body.' });
  }

  const { customer_name, customer_phone, items, total_amount, amount_cents, clover_token } = body;

  if (!customer_name || typeof customer_name !== 'string' || customer_name.trim().length === 0) {
    return res.status(400).json({ success: false, message: 'Customer name is required.' });
  }
  if (!customer_phone || typeof customer_phone !== 'string' || customer_phone.trim().length === 0) {
    return res.status(400).json({ success: false, message: 'Phone number is required.' });
  }
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ success: false, message: 'At least one item is required.' });
  }
  if (typeof total_amount !== 'number' || total_amount <= 0) {
    return res.status(400).json({ success: false, message: 'Invalid order total.' });
  }
  if (typeof amount_cents !== 'number' || amount_cents <= 0 || !Number.isInteger(amount_cents)) {
    return res.status(400).json({ success: false, message: 'Invalid amount.' });
  }
  if (!clover_token || typeof clover_token !== 'string') {
    return res.status(400).json({ success: false, message: 'Payment token is required.' });
  }

  // Verify amount_cents matches total_amount (allow ±1 cent for rounding)
  const expectedCents = Math.round(total_amount * 100);
  if (Math.abs(amount_cents - expectedCents) > 1) {
    return res.status(400).json({ success: false, message: 'Amount mismatch.' });
  }

  // Validate each item has required fields
  for (const item of items) {
    if (!item.name || typeof item.name !== 'string') {
      return res.status(400).json({ success: false, message: 'Invalid item data.' });
    }
    if (typeof item.qty !== 'number' || item.qty < 1) {
      return res.status(400).json({ success: false, message: 'Invalid item quantity.' });
    }
    if (typeof item.price !== 'number' || item.price < 0) {
      return res.status(400).json({ success: false, message: 'Invalid item price.' });
    }
  }

  // Recalculate total from items to prevent client-side price manipulation
  const calculatedTotal = items.reduce((sum, item) => sum + (item.price * item.qty), 0);
  const roundedCalc = Math.round(calculatedTotal * 100) / 100;
  if (Math.abs(roundedCalc - total_amount) > 0.02) {
    console.warn(`Price mismatch: client=${total_amount}, calculated=${roundedCalc}`);
    return res.status(400).json({ success: false, message: 'Order total does not match item prices.' });
  }

  // Sanitize string fields (trim, limit length)
  const sanitized = {
    ...body,
    customer_name: customer_name.trim().slice(0, 200),
    customer_phone: customer_phone.trim().slice(0, 30),
    order_note: body.order_note ? String(body.order_note).trim().slice(0, 1000) : null,
  };

  try {
    const response = await fetch(N8N_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(sanitized),
    });

    const contentType = response.headers.get('content-type') || '';
    let data;

    if (contentType.includes('application/json')) {
      data = await response.json();
    } else {
      const text = await response.text();
      // Try to parse as JSON anyway
      try {
        data = JSON.parse(text);
      } catch {
        data = { success: false, message: text || `Webhook returned status ${response.status}` };
      }
    }

    if (!response.ok) {
      return res.status(response.status).json({
        success: false,
        message: data?.message || `Webhook error: ${response.status}`,
      });
    }

    return res.status(200).json(data);
  } catch (err) {
    console.error('place-order proxy error:', err);
    return res.status(502).json({
      success: false,
      message: 'Could not reach payment server. Please try again.',
    });
  }
}
