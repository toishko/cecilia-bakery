// Vercel Serverless Function — proxies order to n8n webhook
// This avoids CORS issues since the request comes from the server, not the browser.

export default async function handler(req, res) {
  // Only allow POST
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  const N8N_WEBHOOK_URL =
    process.env.N8N_WEBHOOK_URL ||
    'https://toisko.com/webhook/3c47e3d7-1bbf-45b1-a02f-5e2e2a3f9756';

  try {
    const response = await fetch(N8N_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body),
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
