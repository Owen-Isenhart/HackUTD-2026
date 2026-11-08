const REASONS = ['repeat_timing', 'spend_baseline', 'limited_evidence'];

function completionUrl(baseUrl) {
  const url = new URL(baseUrl || 'http://127.0.0.1:8000/v1');
  const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback))
    || url.username || url.password || url.search || url.hash) {
    throw new Error('Use an HTTPS endpoint or a loopback SSH tunnel for Nemotron.');
  }
  url.pathname = url.pathname.replace(/\/$/, '') + '/chat/completions';
  return url;
}

async function interpretRoutines(routines, { env, fetchImpl }) {
  if (routines.length === 0) return { status: 'no_routine' };

  const candidates = routines.slice(0, 8).map((routine, index) => ({
    index,
    category: routine.category,
    weekday: routine.weekday,
    daypart: routine.daypart,
    observedDays: routine.observedDays,
    typicalPurchaseCents: routine.typicalPurchaseCents,
  }));
  const fallback = { status: 'unavailable', routineIndex: 0 };
  const model = env.NEMOTRON_MODEL || 'nemotron-bolt';
  const headers = { 'Content-Type': 'application/json' };
  if (env.NEMOTRON_API_KEY) headers.Authorization = `Bearer ${env.NEMOTRON_API_KEY}`;

  try {
    const response = await fetchImpl(completionUrl(env.NEMOTRON_BASE_URL), {
      method: 'POST',
      headers,
      redirect: 'error',
      signal: AbortSignal.timeout(15000),
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'system',
            content: 'Choose one observed purchasing routine worth showing on a finance profile. Prefer recurring time patterns with more distinct observation days. Use limited_evidence if the pattern is sparse. Only select a candidate index and a reason. Do not infer income, goals, affordability, or future visits.',
          },
          { role: 'user', content: JSON.stringify(candidates) },
        ],
        temperature: 0,
        max_tokens: 96,
        chat_template_kwargs: { enable_thinking: false },
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'routine_insight',
            strict: true,
            schema: {
              type: 'object',
              additionalProperties: false,
              properties: {
                routineIndex: { type: 'integer', enum: candidates.map(({ index }) => index) },
                reason: { type: 'string', enum: REASONS },
              },
              required: ['routineIndex', 'reason'],
            },
          },
        },
      }),
    });
    if (!response.ok) return { ...fallback, error: `http_${response.status}` };

    const result = await response.json();
    let insight;
    try {
      insight = JSON.parse(result.choices?.[0]?.message?.content);
    } catch {
      return { ...fallback, error: 'invalid_response' };
    }
    if (!insight || Object.keys(insight).length !== 2 || !Number.isInteger(insight.routineIndex)
      || !candidates[insight.routineIndex] || !REASONS.includes(insight.reason)) {
      return { ...fallback, error: 'invalid_response' };
    }
    const routine = routines[insight.routineIndex];
    if (insight.reason === 'repeat_timing' && !routine.daypart) {
      return { ...fallback, error: 'unsupported_interpretation' };
    }
    return { status: 'interpreted', model, routineIndex: insight.routineIndex, reason: insight.reason };
  } catch {
    return { ...fallback, error: 'request_failed' };
  }
}

module.exports = { interpretRoutines };
