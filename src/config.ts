import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { z } from "zod";

// Node does not overwrite values already supplied by a deployment secret store.
for (const file of [".env.deals.runtime.local", ".env.deals.local"]) {
  if (existsSync(file)) loadEnvFile(file);
}

const optional = z
  .string()
  .optional()
  .transform((v) => v || undefined);
const schema = z.object({
  DATABASE_URL: optional,
  WORKER_DATABASE_URL: optional,
  ADMIN_DATABASE_URL: optional,
  DEALS_AUTH_SECRET: optional,
  DEALS_AUTH_ISSUER: z.string().default("nessiessential"),
  DEALS_AUTH_AUDIENCE: z.string().default("nessiessential-api"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  HOST: z.string().default("127.0.0.1"),
  PHOTON_API_BASE_URL: z.url().default("https://api.photon.codes"),
  PHOTON_PROJECT_ID: optional,
  PHOTON_API_KEY: optional,
  PHOTON_EMAIL_DOMAIN: z.string().default("deals.getcompfy.com"),
  PHOTON_WEBHOOK_SECRET: optional,
  PHOTON_WEBHOOK_URL: optional,
  PHOTON_WEBHOOK_DESTINATION_ID: optional,
  PHOTON_OPERATION_ID: z.string().default("pho_opr_01m6wm910dfvk94fa4jh8gv7b9"),
  PHOTON_RECONCILE_INTERVAL_SECONDS: z.coerce
    .number()
    .int()
    .min(60)
    .default(300),
  PHOTON_EMAIL_ENTITLEMENT_CONFIRMED: z
    .string()
    .default("false")
    .transform((v) => v === "true"),
  NEMOTRON_BASE_URL: optional,
  NEMOTRON_API_KEY: optional,
  NEMOTRON_MODEL: optional,
});
export type Config = z.infer<typeof schema>;
export const config = schema.parse(process.env);

export function required(value: string | undefined, name: string): string {
  if (!value) throw new Error(`Missing server configuration: ${name}`);
  return value;
}
