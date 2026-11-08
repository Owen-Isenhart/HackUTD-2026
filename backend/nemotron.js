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

async function requestInsight({ name, prompt, facts, properties, timeout = 15000 }, { env, fetchImpl }) {
  const model = env.NEMOTRON_MODEL || 'nemotron-bolt';
  const headers = { 'Content-Type': 'application/json' };
  if (env.NEMOTRON_API_KEY) headers.Authorization = `Bearer ${env.NEMOTRON_API_KEY}`;

  try {
    const response = await fetchImpl(completionUrl(env.NEMOTRON_BASE_URL), {
      method: 'POST',
      headers,
      redirect: 'error',
      signal: AbortSignal.timeout(timeout),
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: prompt },
          { role: 'user', content: JSON.stringify(facts) },
        ],
        temperature: 0,
        max_tokens: 96,
        chat_template_kwargs: { enable_thinking: false },
        response_format: {
          type: 'json_schema',
          json_schema: {
            name,
            strict: true,
            schema: {
              type: 'object',
              additionalProperties: false,
              properties,
              required: Object.keys(properties),
            },
          },
        },
      }),
    });
    if (!response.ok) return { error: `http_${response.status}` };

    const result = await response.json();
    try {
      return { insight: JSON.parse(result.choices?.[0]?.message?.content), model };
    } catch {
      return { error: 'invalid_response' };
    }
  } catch {
    return { error: 'request_failed' };
  }
}

async function interpretRoutines(routines, options) {
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
  const { insight, model, error } = await requestInsight({
    name: 'routine_insight',
    prompt: 'Choose one observed purchasing routine worth showing on a finance profile. Prefer recurring time patterns with more distinct observation days. Use limited_evidence if the pattern is sparse. Only select a candidate index and a reason. Do not infer income, goals, affordability, or future visits.',
    facts: candidates,
    properties: {
      routineIndex: { type: 'integer', enum: candidates.map(({ index }) => index) },
      reason: { type: 'string', enum: REASONS },
    },
  }, options);
  if (error) return { ...fallback, error };
  if (!insight || Object.keys(insight).length !== 2 || !Number.isInteger(insight.routineIndex)
    || !candidates[insight.routineIndex] || !REASONS.includes(insight.reason)) {
    return { ...fallback, error: 'invalid_response' };
  }
  if (insight.reason === 'repeat_timing' && !routines[insight.routineIndex].daypart) {
    return { ...fallback, error: 'unsupported_interpretation' };
  }
  return { status: 'interpreted', model, routineIndex: insight.routineIndex, reason: insight.reason };
}

async function explainRecommendation({ routine, payableCents, cashbackCents }, options) {
  const reasons = ['routine_fit', 'estimated_cashback'];
  const { insight, model } = await requestInsight({
    name: 'recommendation_explanation',
    prompt: 'An app selected an eligible demo offer. Choose the most useful fact to emphasize: repeat timing (routine_fit) or the estimated cashback (estimated_cashback). Return only the reason. The selection and all amounts are fixed.',
    facts: {
      category: routine.category, weekday: routine.weekday, daypart: routine.daypart,
      observedDays: routine.observedDays, payableCents, cashbackCents,
    },
    properties: { reason: { type: 'string', enum: reasons } },
    timeout: 5000,
  }, options);
  if (!insight || Object.keys(insight).length !== 1 || !reasons.includes(insight.reason)) {
    return { status: 'fallback', reason: 'routine_fit' };
  }
  return { status: 'interpreted', model, reason: insight.reason };
}

module.exports = { interpretRoutines, explainRecommendation };
