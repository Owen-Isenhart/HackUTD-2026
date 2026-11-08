export type Source = {
  product: string;
  status: string;
  reason: string | null;
  last_success_at: string | null;
};
export type Enrollment = {
  id: string;
  version: number;
  program_id: string;
  name: string;
  state: string;
  loyalty_status: string;
  promotion_status: string;
  reason: string | null;
  signup_url: string;
  preferences_url: string;
  suppressed_at: string | null;
  opted_out_at: string | null;
  inactivity_at: string;
  evidence: { kind?: string };
};
export type Program = { id: string; name: string };
export type EnrollmentFlowState = {
  enrollmentId: string;
  version: number;
  merchant: string;
  state: string;
  signupStatus: string;
  existingMembership: "yes" | "no" | "unknown";
  promotionalAddress: string;
  nextAction: string;
  url: string;
  requiredInputs: string[];
  externalOutcome: string;
  safeToCreateAccount: boolean;
  intent: string;
  loyaltyStatus?: string;
  promotionStatus?: string;
  instructions?: string[] | null;
};
export type Offer = {
  id: string;
  program_id: string;
  merchant_name: string;
  status: string;
  reasons: string[];
  revision: number;
  message_id: string;
  expires_at: string | null;
  stale_at: string;
  terms: {
    title?: string;
    currency?: string;
    code?: string | null;
    benefit?: {
      type: string;
      rateBps: number | null;
      amountMinor: number | null;
      upTo: boolean;
    };
    channels?: string[];
    products?: string[];
    exclusions?: string[];
    membershipRequired?: boolean | null;
    activationRequired?: boolean | null;
    stacking?: string;
    minSpendMinor?: number | null;
    payout?: { form: string; timing: string | null };
    evidence?: Record<string, { quote: string }>;
    redemptionUrl?: string | null;
  };
};
export type Status = {
  profile: {
    timezone: string;
    consent_at: string | null;
    revoked_at: string | null;
  };
  identity: { address: string; disabled_at: string | null } | null;
  sources: Source[];
  jobs: {
    id: string;
    kind: string;
    state: string;
    last_error: string | null;
  }[];
  providerDeletion: string;
};
export type Message = {
  id: string;
  sender: string;
  subject: string;
  classification: string;
  received_at: string;
  sanitized_text?: string | null;
};
export type Session = { baseUrl: string; token: string };
export async function request<T>(
  session: Session,
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch(
    `${session.baseUrl.replace(/\/$/, "")}/v1/deals${path}`,
    {
      ...options,
      headers: {
        Authorization: `Bearer ${session.token}`,
        "Content-Type": "application/json",
      },
    },
  );
  const body = await response.json();
  if (!response.ok)
    throw new Error(
      body.error === "invalid_or_expired_token"
        ? "Your session expired. Sign in again."
        : String(body.error ?? "Connection unavailable").replaceAll("_", " "),
    );
  return body as T;
}
export const human = (value: string) => value.replaceAll("_", " ");
export const date = (value: string | null | undefined) =>
  value
    ? new Date(value).toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      })
    : "Unknown";
export const money = (value: number | null | undefined) =>
  value === null || value === undefined
    ? "Unknown"
    : new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
      }).format(value / 100);
export async function openMerchant(url: string) {
  const parsed = new URL(url);
  const domains = [
    "chipotle.com",
    "panerabread.com",
    "capitalone.com",
    "capitaloneoffers.com",
    "capitaloneshopping.com",
  ];
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    !domains.some(
      (d) => parsed.hostname === d || parsed.hostname.endsWith(`.${d}`),
    )
  )
    throw new Error("This merchant link needs review before opening.");
  const { Linking } = await import("react-native");
  await Linking.openURL(url);
}
