// Utility for Logging & Cost Calculation of AI Usage (OpenAI & Google Gemini)
// Logs asynchronously to Supabase 'ai_usage_logs' without blocking API responses.

export const MODEL_RATES = {
  // OpenAI Models (Prices per 1,000,000 tokens)
  'gpt-4o-2024-11-20': { input: 2.50, output: 10.00 },
  'gpt-4o':             { input: 2.50, output: 10.00 },
  'gpt-4o-mini':        { input: 0.15, output: 0.60  },

  // Google Gemini Models (Prices per 1,000,000 tokens)
  'gemini-2.0-flash':   { input: 0.10, output: 0.40  },
  'gemini-1.5-flash':   { input: 0.075, output: 0.30 },
  'gemini-1.5-pro':     { input: 1.25, output: 5.00  },

  // Default fallback
  'default':            { input: 1.00, output: 3.00  }
};

/**
 * Calculates the exact dollar cost in USD for a model call.
 * @param {string} model - Model identifier
 * @param {number} inputTokens - Number of prompt/input tokens
 * @param {number} outputTokens - Number of completion/output tokens
 * @returns {number} Cost in USD rounded to 6 decimal places (e.g. 0.002450)
 */
export function calculateAiCost(model, inputTokens = 0, outputTokens = 0) {
  const normModel = (model || '').toLowerCase().trim();
  let rates = MODEL_RATES[normModel];

  if (!rates) {
    // Sort keys by length descending so specific names like 'gpt-4o-mini' match before 'gpt-4o'
    const sortedKeys = Object.keys(MODEL_RATES)
      .filter(k => k !== 'default')
      .sort((a, b) => b.length - a.length);

    for (const key of sortedKeys) {
      if (normModel.includes(key)) {
        rates = MODEL_RATES[key];
        break;
      }
    }
  }

  if (!rates) {
    rates = MODEL_RATES['default'];
  }

  const inCost = (Number(inputTokens || 0) / 1_000_000) * rates.input;
  const outCost = (Number(outputTokens || 0) / 1_000_000) * rates.output;
  return Number((inCost + outCost).toFixed(6));
}

/**
 * Extracts token counts from standard OpenAI Chat Completion JSON response.
 */
export function extractOpenAiTokens(data) {
  const usage = data?.usage || {};
  const inputTokens = Number(usage.prompt_tokens || 0);
  const outputTokens = Number(usage.completion_tokens || 0);
  const totalTokens = Number(usage.total_tokens || (inputTokens + outputTokens));
  return { inputTokens, outputTokens, totalTokens };
}

/**
 * Extracts token counts from standard Google Gemini generateContent JSON response.
 */
export function extractGeminiTokens(data) {
  const usage = data?.usageMetadata || {};
  const inputTokens = Number(usage.promptTokenCount || 0);
  const outputTokens = Number(usage.candidatesTokenCount || 0);
  const totalTokens = Number(usage.totalTokenCount || (inputTokens + outputTokens));
  return { inputTokens, outputTokens, totalTokens };
}

/**
 * Logs an AI usage record asynchronously to Supabase.
 * Does NOT throw errors and will not block or crash serverless functions.
 */
export async function logAiUsage({
  feature,              // 'ticket_scanner' | 'voice_order'
  callerRole = 'admin', // 'admin' | 'driver' | 'shortcut' | 'anonymous'
  callerIdentifier,     // Email, driver name, or IP
  provider,             // 'openai' | 'google_gemini'
  model,                // e.g. 'gpt-4o-2024-11-20'
  callType,             // 'parallel_slice', 'single_pass', 'fallback_cascade', 'voice_audio', 'voice_text'
  inputTokens = 0,
  outputTokens = 0,
  totalTokens = 0,
  estimatedCostUsd = null,
  executionMs = 0,
  status = 'success',   // 'success' | 'zero_items' | 'api_error' | 'fallback_triggered'
  isWaste = false,      // boolean
  wasteReason = null,   // string
  metadata = {}
}) {
  try {
    const supabaseUrl = process.env.SUPABASE_URL || 'https://dykztphptnytbihpavpa.supabase.co';
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR5a3p0cGhwdG55dGJpaHBhdnBhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM4OTY4NzksImV4cCI6MjA4OTQ3Mjg3OX0.jinnkmJj5tjYmMXPEx0FsbE8qHKU2j6kvv5HyczWr4w';

    const calcCost = estimatedCostUsd !== null 
      ? Number(estimatedCostUsd) 
      : calculateAiCost(model, inputTokens, outputTokens);

    const payload = {
      feature: feature || 'unknown',
      caller_role: callerRole,
      caller_identifier: callerIdentifier ? String(callerIdentifier).slice(0, 100) : 'unknown',
      provider: provider || 'openai',
      model: model || 'unknown',
      call_type: callType || 'single_pass',
      input_tokens: Number(inputTokens || 0),
      output_tokens: Number(outputTokens || 0),
      total_tokens: Number(totalTokens || (inputTokens + outputTokens)),
      estimated_cost_usd: calcCost,
      execution_ms: Number(executionMs || 0),
      status: status,
      is_waste: Boolean(isWaste),
      waste_reason: wasteReason || null,
      metadata: metadata && typeof metadata === 'object' ? metadata : {}
    };

    const res = await fetch(`${supabaseUrl}/rest/v1/ai_usage_logs`, {
      method: 'POST',
      headers: {
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      const errText = await res.text();
      console.warn('AI usage log insert warning:', res.status, errText);
    }
  } catch (err) {
    // Non-blocking catch to ensure core function reliability
    console.error('AI usage logging exception:', err.message);
  }
}
