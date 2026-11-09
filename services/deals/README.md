# HackUTD-2026

Nessiessential is a mobile personal-finance project. The deals workstream now includes a TypeScript/Fastify API, PostgreSQL worker and Expo screens for promotional email, offer evidence, eligibility and merchant rewards lifecycle.

```sh
npm ci
npm run check
npm start                 # API; needs local server configuration
npm run worker            # separate terminal
npm run owner:create      # writes a private one-hour session to .local/
cd mobile
npm ci
npm start                 # Expo deals shell
```

TigerData migrations and restricted runtime roles have been applied to the existing service. Credentials stay in ignored owner-only local files. An actual user-sent email passed signed Photon delivery, durable storage and deduplicated processing. Backend checks pass 61 tests; mobile typecheck and iOS/Android exports pass. Real merchant registration/promotional delivery and Capital One acquisition are **not yet accepted**. No commit or push has been made.
