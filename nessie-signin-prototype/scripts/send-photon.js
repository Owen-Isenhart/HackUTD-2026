const { randomUUID } = require('node:crypto');
const { merchants, recommend } = require('./demo-profile');

async function send() {
  const [merchantMinor, mode] = process.argv.slice(2);
  const merchant = merchants.find(({ minor }) => String(minor) === merchantMinor);
  if (!merchant || (mode !== undefined && mode !== 'cheaper')) {
    throw new Error('Usage: npm run photon:send -- <1|2|3> [cheaper]');
  }

  const { PHOTON_PROJECT_ID, PHOTON_API_KEY, PHOTON_AGENT_USER_ID, PHOTON_RECIPIENT } = process.env;
  if (!PHOTON_PROJECT_ID || !PHOTON_API_KEY || !PHOTON_AGENT_USER_ID || !PHOTON_RECIPIENT) {
    throw new Error('Fill in the Photon 2.0 values in .env. See .env.example.');
  }

  async function post(path, body) {
    const response = await fetch(`https://api.photon.codes/v1/projects/${encodeURIComponent(PHOTON_PROJECT_ID)}/${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${PHOTON_API_KEY}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': randomUUID(),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error(`Photon ${path} returned HTTP ${response.status}. Check the Photon dashboard for details.`);
    return response;
  }

  const platform = 'imessage';
  const customer = await (await post('users', { platform, handle: PHOTON_RECIPIENT })).json();
  const space = await (await post('spaces', {
    platform, participantIds: [PHOTON_AGENT_USER_ID, customer.id],
  })).json();
  const result = recommend(merchant);
  const text = `Hands-Off Banking demo · ${merchant.name}. ${mode === 'cheaper' ? result.alternative : result.advice}`;
  await post('messages', {
    spaceId: space.id,
    senderId: PHOTON_AGENT_USER_ID,
    content: { type: 'text', format: 'plain', text },
  });
  console.log('Photon accepted the demo iMessage. Check the recipient phone or Photon dashboard for delivery.');
}

send().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
