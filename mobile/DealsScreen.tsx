import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import {
  date,
  human,
  money,
  openMerchant,
  request,
  type Enrollment,
  type Message,
  type Offer,
  type Session,
  type Status,
} from "./api";
import { OfferReview } from "./OfferReview";
import { EnrollmentFlow } from "./EnrollmentFlow";

export function DealsScreen({
  session,
  onSignOut,
}: {
  session: Session;
  onSignOut: () => Promise<void>;
}) {
  const [status, setStatus] = useState<Status | null>(null),
    [enrollments, setEnrollments] = useState<Enrollment[]>([]),
    [offers, setOffers] = useState<Offer[]>([]),
    [messages, setMessages] = useState<Message[]>([]);
  const [tab, setTab] = useState<"offers" | "rewards" | "sources">("offers"),
    [selected, setSelected] = useState<Offer | null>(null),
    [source, setSource] = useState<Message | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [timezone, setTimezone] = useState(
      Intl.DateTimeFormat().resolvedOptions().timeZone,
    ),
    [agree, setAgree] = useState(false);
  const [verification, setVerification] = useState<string | null>(null),
    [messageId, setMessageId] = useState(""),
    [existing, setExisting] = useState(false),
    [loyaltyConfirmed, setLoyaltyConfirmed] = useState(false),
    [promotions, setPromotions] = useState(false),
    [proofChecked, setProofChecked] = useState(false),
    [alreadyMember, setAlreadyMember] = useState(true);
  const load = useCallback(
    async (signal?: AbortSignal) => {
      const [s, e, o, m] = await Promise.all([
        request<Status>(session, "/status", { signal }),
        request<Enrollment[]>(session, "/enrollments", { signal }),
        request<Offer[]>(session, "/offers", { signal }),
        request<Message[]>(session, "/messages", { signal }),
      ]);
      if (!signal?.aborted) {
        setStatus(s);
        setEnrollments(e);
        setOffers(o);
        setMessages(m);
        setError("");
      }
    },
    [session],
  );
  useEffect(() => {
    const controller = new AbortController();
    setBusy(true);
    load(controller.signal)
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setBusy(false);
      });
    return () => controller.abort();
  }, [load]);
  async function action(fn: () => Promise<unknown>) {
    setBusy(true);
    try {
      await fn();
      await load();
      setError("");
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Unable to complete this action",
      );
    } finally {
      setBusy(false);
    }
  }
  const post = (path: string, body?: unknown) =>
    request(session, path, {
      method: "POST",
      body: JSON.stringify(body ?? {}),
    });
  const consented = !!status?.profile.consent_at && !status.profile.revoked_at;
  function withdraw() {
    Alert.alert(
      "Disconnect deals?",
      "This stops new ingestion and removes local offer content. Loyalty accounts and earned rewards are preserved. Merchant unsubscribe remains pending until confirmed.",
      [
        { text: "Keep connected", style: "cancel" },
        {
          text: "Disconnect",
          style: "destructive",
          onPress: () =>
            action(() => request(session, "/consent", { method: "DELETE" })),
        },
      ],
    );
  }
  function optOut(e: Enrollment) {
    Alert.alert(
      `Stop ${e.name} promotions?`,
      "Offers will be hidden immediately. Complete unsubscribe at the merchant to stop its email. Purchases will not override this choice.",
      [
        { text: "Keep", style: "cancel" },
        {
          text: "Stop promotions",
          onPress: () => action(() => post(`/enrollments/${e.id}/opt-out`)),
        },
      ],
    );
  }
  async function showEvidence(o: Offer) {
    setSource(null);
    await action(async () => {
      const m = await request<Message>(session, `/messages/${o.message_id}`);
      setSource(m);
    });
  }
  return (
    <View style={s.fill}>
      <View style={s.top}>
        <Text style={s.brand}>NESSIESSENTIAL</Text>
        <Pressable accessibilityRole="button" onPress={() => action(onSignOut)}>
          <Text style={s.link}>Sign out</Text>
        </Pressable>
      </View>
      <ScrollView
        contentContainerStyle={s.page}
        refreshControl={
          <RefreshControl
            refreshing={busy}
            onRefresh={() => action(() => load())}
          />
        }
        keyboardShouldPersistTaps="handled"
      >
        <Text style={s.eyebrow}>YOUR MONEY, WITH MORE CLARITY</Text>
        <Text style={s.title}>A little more{"\n"}in your pocket.</Text>
        <Text style={s.subtitle}>
          Private offers. Visible conditions. Rewards you can keep track of.
        </Text>
        {!!error && (
          <View style={s.errorBox}>
            <Text accessibilityRole="alert" style={s.error}>
              {error}
            </Text>
            <Button
              label="Try again"
              onPress={() => action(() => load())}
              disabled={busy}
            />
          </View>
        )}
        {!status && busy && (
          <ActivityIndicator accessibilityLabel="Loading your deals" />
        )}
        {status && !consented ? (
          <View style={s.card}>
            <Text style={s.cardTitle}>Connect your promotional inbox</Text>
            <Text style={s.body}>
              We’ll create a private address for merchant promotions, extract
              offer terms, and help manage rewards registration. Verification
              may need your input.
            </Text>
            <Text style={s.body}>
              Sanitized email text is kept for up to 7 days. Offer evidence is
              retained through validity plus 30 days. Unknown-expiry offers stop
              being current after 7 days. Loyalty accounts stay yours.
            </Text>
            <Text style={s.label}>Your timezone</Text>
            <TextInput
              accessibilityLabel="Your timezone"
              value={timezone}
              onChangeText={setTimezone}
              style={s.input}
              autoCapitalize="none"
            />
            <Toggle
              label="I agree to promotional email processing and merchant enrollment assistance."
              value={agree}
              onChange={setAgree}
            />
            <Button
              label={
                status.profile.revoked_at ? "Reconnect deals" : "Connect deals"
              }
              disabled={!agree || busy}
              onPress={() =>
                action(() =>
                  post("/consent", { timezone, version: "deals-v1" }),
                )
              }
            />
          </View>
        ) : (
          <>
            <View style={s.summary}>
              <View>
                <Text style={s.summaryNumber}>
                  {
                    offers.filter(
                      (o) =>
                        o.status === "active" &&
                        (!o.expires_at ||
                          Date.parse(o.expires_at) > Date.now()) &&
                        Date.parse(o.stale_at) > Date.now(),
                    ).length
                  }
                </Text>
                <Text style={s.summaryLabel}>Reviewed offers</Text>
              </View>
              <View style={s.summaryDivider} />
              <View>
                <Text style={s.summaryNumber}>
                  {enrollments.filter((e) => e.state === "enrolled").length}
                </Text>
                <Text style={s.summaryLabel}>Confirmed rewards</Text>
              </View>
              <Text style={s.summaryNote}>
                Eligibility still depends{"\n"}on your purchase.
              </Text>
            </View>
            <View style={s.tabs}>
              {(["offers", "rewards", "sources"] as const).map((t) => (
                <Pressable
                  accessibilityRole="tab"
                  accessibilityState={{ selected: tab === t }}
                  key={t}
                  onPress={() => {
                    setTab(t);
                    setSelected(null);
                    setSource(null);
                  }}
                  style={[s.tab, tab === t && s.activeTab]}
                >
                  <Text style={[s.tabText, tab === t && s.activeTabText]}>
                    {t[0]!.toUpperCase() + t.slice(1)}
                  </Text>
                </Pressable>
              ))}
            </View>
            {tab === "offers" && (
              <>
                <View style={s.sectionRow}>
                  <Text style={s.sectionTitle}>Your offers</Text>
                  <Text style={s.muted}>{offers.length} received</Text>
                </View>
                {!offers.length && (
                  <Empty
                    title="Your next deal starts here"
                    text="No promotional offers have been received yet. Check Sources for inbox readiness, and Rewards for merchant verification steps."
                  />
                )}
                {offers.map((o) => (
                  <Pressable
                    accessibilityRole="button"
                    key={o.id}
                    onPress={() => {
                      setSelected(selected?.id === o.id ? null : o);
                      setSource(null);
                    }}
                    style={s.card}
                  >
                    <View style={s.sectionRow}>
                      <Text style={s.merchant}>{o.merchant_name}</Text>
                      <Badge
                        text={
                          o.expires_at && Date.parse(o.expires_at) <= Date.now()
                            ? "expired"
                            : Date.parse(o.stale_at) <= Date.now()
                              ? "stale"
                              : o.status
                        }
                      />
                    </View>
                    <Text style={s.offerTitle}>
                      {o.terms.title ?? "Offer content removed"}
                    </Text>
                    <Text style={s.muted}>
                      Expires {date(o.expires_at)} · Private to your account
                    </Text>
                    {selected?.id === o.id && (
                      <View style={s.detail}>
                        <Text style={s.body}>
                          Applies to:{" "}
                          {o.terms.products?.join(", ") || "Needs review"}
                        </Text>
                        <Text style={s.body}>
                          Where:{" "}
                          {o.terms.channels?.map(human).join(", ") ||
                            "Channel unknown"}
                        </Text>
                        <Text style={s.body}>
                          Minimum eligible spend: {money(o.terms.minSpendMinor)}
                        </Text>
                        <Text style={s.body}>
                          Membership:{" "}
                          {o.terms.membershipRequired === null
                            ? "Unknown"
                            : o.terms.membershipRequired
                              ? "Required"
                              : "Not required"}
                        </Text>
                        <Text style={s.body}>
                          Activation:{" "}
                          {o.terms.activationRequired === null
                            ? "Unknown"
                            : o.terms.activationRequired
                              ? "Required before purchase"
                              : "Not required"}
                        </Text>
                        <Text style={s.body}>
                          Stacking: {human(o.terms.stacking ?? "unknown")}
                        </Text>
                        {o.terms.code && (
                          <Text selectable style={s.code}>
                            Code: {o.terms.code}
                          </Text>
                        )}
                        {!!o.terms.exclusions?.length && (
                          <Text style={s.body}>
                            Exclusions: {o.terms.exclusions.join("; ")}
                          </Text>
                        )}
                        {o.terms.payout && (
                          <Text style={s.body}>
                            Reward: {human(o.terms.payout.form)}.{" "}
                            {o.terms.payout.timing ?? "Timing unknown."}
                          </Text>
                        )}
                        {o.reasons.map((r) => (
                          <Text key={r} style={s.reviewReason}>
                            • {human(r)}
                          </Text>
                        ))}
                        <Text style={s.note}>
                          This offer does not establish a product price or show
                          that a purchase fits your budget.
                        </Text>
                        <Button
                          label="View source evidence"
                          onPress={() => showEvidence(o)}
                          disabled={busy}
                        />
                        {source && (
                          <View style={s.evidence}>
                            <Text style={s.label}>{source.subject}</Text>
                            <Text style={s.muted}>
                              {source.sender} · {date(source.received_at)}
                            </Text>
                            <Text selectable style={s.body}>
                              {source.sanitized_text ??
                                "Email text has reached its retention limit."}
                            </Text>
                          </View>
                        )}
                        {source?.sanitized_text &&
                          ["needs_review", "active", "stale"].includes(
                            o.status,
                          ) && (
                            <OfferReview
                              key={`${o.id}:${o.revision}`}
                              offer={o}
                              sourceText={source.sanitized_text}
                              session={session}
                              onSaved={async () => {
                                await load();
                                setSelected(null);
                                setSource(null);
                              }}
                            />
                          )}
                        {o.terms.redemptionUrl && (
                          <Button
                            label="Open official redemption page ↗"
                            onPress={() =>
                              action(() => openMerchant(o.terms.redemptionUrl!))
                            }
                            secondary
                          />
                        )}
                      </View>
                    )}
                  </Pressable>
                ))}
              </>
            )}
            {tab === "rewards" && (
              <>
                <Text style={s.sectionTitle}>Merchant rewards</Text>
                <Text style={s.body}>
                  Verified purchases start one registration process per
                  merchant. Existing accounts and earned rewards are preserved.
                </Text>
                <EnrollmentFlow
                  session={session}
                  enrollments={enrollments}
                  onChange={() => load()}
                />
                {!enrollments.length && (
                  <Empty
                    title="Waiting for purchase history"
                    text="Supported merchants will appear after verified purchases are connected. Sandbox test purchases never create real merchant accounts."
                  />
                )}
                {enrollments.map((e) => (
                  <View key={e.id} style={s.card}>
                    <View style={s.sectionRow}>
                      <Text style={s.cardTitle}>{e.name}</Text>
                      <Badge text={e.state} />
                    </View>
                    <Text style={s.body}>
                      Loyalty: {human(e.loyalty_status)}
                      {"\n"}Promotions: {human(e.promotion_status)}
                    </Text>
                    <Text style={s.muted}>
                      Inactivity review: {date(e.inactivity_at)}
                    </Text>
                    {e.reason && (
                      <Text style={s.reviewReason}>{human(e.reason)}</Text>
                    )}
                    {e.suppressed_at ? (
                      <>
                        <Button
                          label="Manage email at merchant ↗"
                          onPress={() =>
                            action(() => openMerchant(e.preferences_url))
                          }
                          secondary
                        />
                        {e.promotion_status !== "unsubscribed" && (
                          <Button
                            label="I completed merchant unsubscribe"
                            onPress={() =>
                              action(() =>
                                post(
                                  `/enrollments/${e.id}/confirm-unsubscribe`,
                                  {
                                    completedAtMerchant: true,
                                    expectedVersion: e.version,
                                  },
                                ),
                              )
                            }
                            disabled={busy}
                          />
                        )}
                        <Button
                          label="Resume promotions"
                          onPress={() =>
                            action(() => post(`/enrollments/${e.id}/resume`))
                          }
                          secondary
                          disabled={busy}
                        />
                      </>
                    ) : (
                      <>
                        {(e.state !== "enrolled" ||
                          e.promotion_status !== "subscribed") && (
                          <>
                            <Text style={s.note}>
                              Check for an existing account before creating one.
                              Complete the merchant’s identity and phone
                              verification. Submitting a form does not confirm
                              registration.
                            </Text>
                            <Button
                              label="Open existing account / preferences ↗"
                              onPress={() =>
                                action(() => openMerchant(e.preferences_url))
                              }
                            />
                            <Button
                              label="Verify my outcome"
                              onPress={() => {
                                setVerification(
                                  verification === e.id ? null : e.id,
                                );
                                setMessageId("");
                                setExisting(false);
                                setLoyaltyConfirmed(false);
                                setPromotions(false);
                                setProofChecked(false);
                                setAlreadyMember(true);
                              }}
                              secondary
                            />
                          </>
                        )}
                        {verification === e.id && (
                          <View style={s.detail}>
                            <Toggle
                              label="I checked for an existing membership"
                              value={existing}
                              onChange={setExisting}
                            />
                            <Toggle
                              label="Merchant confirmed loyalty membership"
                              value={loyaltyConfirmed}
                              onChange={setLoyaltyConfirmed}
                            />
                            <Toggle
                              label="This was an existing loyalty account"
                              value={alreadyMember}
                              onChange={setAlreadyMember}
                            />
                            <Toggle
                              label="Merchant confirmed promotional subscription"
                              value={promotions}
                              onChange={setPromotions}
                            />
                            <Toggle
                              label="I verified the confirmation sender and selected outcomes"
                              value={proofChecked}
                              onChange={setProofChecked}
                            />
                            <Text style={s.label}>
                              Select the merchant confirmation email
                            </Text>
                            {messages.map((m) => (
                              <Pressable
                                accessibilityRole="radio"
                                accessibilityState={{
                                  checked: messageId === m.id,
                                }}
                                key={m.id}
                                onPress={() => setMessageId(m.id)}
                                style={[
                                  s.emailOption,
                                  messageId === m.id && s.emailSelected,
                                ]}
                              >
                                <Text style={s.body}>
                                  {m.subject || "No subject"}
                                </Text>
                                <Text style={s.muted}>{m.sender}</Text>
                              </Pressable>
                            ))}
                            {!messages.length && (
                              <Text style={s.note}>
                                No confirmation emails received. Check Sources.
                              </Text>
                            )}
                            <Button
                              label="Save verified outcomes"
                              disabled={
                                !existing ||
                                !proofChecked ||
                                !messageId ||
                                (!loyaltyConfirmed && !promotions) ||
                                busy
                              }
                              onPress={() =>
                                action(() =>
                                  post(`/enrollments/${e.id}/confirm`, {
                                    messageId,
                                    loyalty: !loyaltyConfirmed
                                      ? "not_enrolled"
                                      : alreadyMember
                                        ? "existing"
                                        : "enrolled",
                                    promotions,
                                    senderVerified: true,
                                    existingMembershipChecked: true,
                                    expectedVersion: e.version,
                                  }),
                                )
                              }
                            />
                          </View>
                        )}
                        <Button
                          label="Stop promotions"
                          onPress={() => optOut(e)}
                          secondary
                          disabled={busy}
                        />
                      </>
                    )}
                  </View>
                ))}
              </>
            )}
            {tab === "sources" && (
              <>
                <Text style={s.sectionTitle}>Connected sources</Text>
                {status?.identity && (
                  <View style={s.inbox}>
                    <Text style={s.label}>
                      YOUR PRIVATE PROMOTIONAL ADDRESS
                    </Text>
                    <Text selectable style={s.address}>
                      {status.identity.address}
                    </Text>
                    <Text style={s.note}>
                      Use this address for supported merchant promotions. Its
                      readiness depends on Photon’s domain verification.
                    </Text>
                  </View>
                )}
                {status?.sources.map((source) => (
                  <View key={source.product} style={s.card}>
                    <View style={s.sectionRow}>
                      <Text style={s.cardTitle}>
                        {source.product === "photon_email"
                          ? "Promotional email"
                          : source.product === "capital_one_offers"
                            ? "Capital One Offers"
                            : "Capital One Shopping"}
                      </Text>
                      <Badge text={source.status} />
                    </View>
                    {source.reason && (
                      <Text style={s.reviewReason}>{human(source.reason)}</Text>
                    )}
                    <Text style={s.muted}>
                      Last successful sync: {date(source.last_success_at)}
                    </Text>
                    {source.product === "photon_email" ? (
                      <Button
                        label="Retry email sync"
                        onPress={() =>
                          action(() => post("/sources/photon_email/retry"))
                        }
                        secondary
                        disabled={busy}
                      />
                    ) : (
                      <>
                        <Text style={s.note}>
                          No offers have been imported from this source.
                          Eligibility and access must be verified with the
                          official service.
                        </Text>
                        <Button
                          label="Visit official service ↗"
                          onPress={() =>
                            action(() =>
                              openMerchant(
                                source.product === "capital_one_offers"
                                  ? "https://www.capitalone.com/"
                                  : "https://capitaloneshopping.com/",
                              ),
                            )
                          }
                          secondary
                        />
                      </>
                    )}
                  </View>
                ))}
                {!!status?.jobs.filter((j) => j.state === "dead").length && (
                  <View style={s.card}>
                    <Text style={s.cardTitle}>Needs attention</Text>
                    {status.jobs
                      .filter((j) => j.state === "dead")
                      .map((j) => (
                        <View key={j.id} style={s.detail}>
                          <Text style={s.reviewReason}>
                            {human(j.kind)}: {human(j.last_error ?? "failed")}
                          </Text>
                          <Button
                            label="Retry after resolving the issue"
                            onPress={() =>
                              action(() => post(`/jobs/${j.id}/retry`))
                            }
                            secondary
                            disabled={busy}
                          />
                        </View>
                      ))}
                  </View>
                )}
                <View style={s.card}>
                  <Text style={s.cardTitle}>Your data, your choice</Text>
                  <Text style={s.body}>{status?.providerDeletion}</Text>
                  <Text style={s.note}>
                    Disconnecting disables this inbox locally and removes
                    private offer content. Complete merchant unsubscribe
                    separately. Your loyalty accounts and rewards are kept.
                  </Text>
                  <Button
                    label="Disconnect and remove local content"
                    onPress={withdraw}
                    secondary
                    disabled={busy}
                  />
                </View>
              </>
            )}
          </>
        )}
        <Text style={s.footer}>A deal is useful when it works for you.</Text>
      </ScrollView>
    </View>
  );
}
function Button({
  label,
  onPress,
  disabled,
  secondary,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  secondary?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[s.button, secondary && s.secondary, disabled && s.disabled]}
    >
      <Text style={[s.buttonText, secondary && s.secondaryText]}>{label}</Text>
    </Pressable>
  );
}
function Toggle({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <View style={s.toggle}>
      <Switch
        accessibilityLabel={label}
        value={value}
        onValueChange={onChange}
        trackColor={{ true: "#1B5E46" }}
      />
      <Text style={[s.body, s.fill]}>{label}</Text>
    </View>
  );
}
function Badge({ text }: { text: string }) {
  return (
    <View
      style={[
        s.badge,
        ["active", "ready", "enrolled"].includes(text) && s.readyBadge,
      ]}
    >
      <Text style={s.badgeText}>{human(text)}</Text>
    </View>
  );
}
function Empty({ title, text }: { title: string; text: string }) {
  return (
    <View style={s.empty}>
      <View style={s.emptyMark}>
        <Text style={s.emptyIcon}>↗</Text>
      </View>
      <Text style={s.emptyTitle}>{title}</Text>
      <Text style={s.emptyText}>{text}</Text>
    </View>
  );
}
const s = StyleSheet.create({
  fill: { flex: 1 },
  top: {
    paddingHorizontal: 24,
    paddingTop: 15,
    paddingBottom: 12,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  brand: {
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 2,
    color: "#376A58",
  },
  link: { color: "#376A58", fontSize: 13 },
  page: {
    padding: 24,
    paddingBottom: 50,
    maxWidth: 680,
    alignSelf: "center",
    width: "100%",
    gap: 16,
  },
  eyebrow: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1.7,
    color: "#6C7E66",
    marginTop: 14,
  },
  title: {
    fontSize: 39,
    lineHeight: 45,
    fontWeight: "700",
    color: "#163D32",
    letterSpacing: -1.3,
  },
  subtitle: {
    fontSize: 15,
    lineHeight: 23,
    color: "#68766B",
    maxWidth: 320,
    marginBottom: 8,
  },
  summary: {
    backgroundColor: "#1B4F3C",
    borderRadius: 20,
    padding: 22,
    flexDirection: "row",
    alignItems: "center",
    gap: 18,
  },
  summaryNumber: { fontSize: 30, color: "#F8F9EF", fontWeight: "700" },
  summaryLabel: { fontSize: 10, color: "#D2DFD2", marginTop: 3 },
  summaryDivider: { width: 1, height: 42, backgroundColor: "#557563" },
  summaryNote: { fontSize: 10, lineHeight: 16, color: "#C3D4C4", flex: 1 },
  tabs: {
    backgroundColor: "#E6EBE2",
    borderRadius: 14,
    padding: 4,
    flexDirection: "row",
    marginVertical: 8,
  },
  tab: { flex: 1, padding: 12, borderRadius: 10, alignItems: "center" },
  activeTab: { backgroundColor: "#FFF" },
  tabText: { fontSize: 13, color: "#718074", fontWeight: "600" },
  activeTabText: { color: "#1B4F3C" },
  sectionRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  sectionTitle: { fontSize: 20, fontWeight: "700", color: "#203D31" },
  card: {
    backgroundColor: "#FFFFFF",
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "#E0E7DC",
    padding: 20,
    gap: 12,
  },
  cardTitle: {
    fontSize: 17,
    fontWeight: "700",
    color: "#203D31",
    flexShrink: 1,
  },
  merchant: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.8,
    textTransform: "uppercase",
    color: "#66806D",
    flexShrink: 1,
  },
  offerTitle: { fontSize: 24, fontWeight: "700", color: "#203D31" },
  muted: { fontSize: 11, lineHeight: 17, color: "#7D897E" },
  body: { fontSize: 14, lineHeight: 22, color: "#56675B" },
  note: { fontSize: 11, lineHeight: 18, color: "#7A867B" },
  label: { fontSize: 11, fontWeight: "700", color: "#355240" },
  input: {
    borderWidth: 1,
    borderColor: "#D3DDD4",
    borderRadius: 10,
    padding: 14,
    fontSize: 14,
    color: "#203D31",
  },
  button: {
    backgroundColor: "#1B5E46",
    borderRadius: 11,
    padding: 14,
    alignItems: "center",
    marginTop: 4,
  },
  secondary: { backgroundColor: "#EEF2E9" },
  buttonText: { color: "#FFF", fontSize: 13, fontWeight: "700" },
  secondaryText: { color: "#365B43" },
  disabled: { opacity: 0.45 },
  badge: {
    backgroundColor: "#FAEFDA",
    borderRadius: 7,
    paddingHorizontal: 8,
    paddingVertical: 5,
    maxWidth: 150,
  },
  readyBadge: { backgroundColor: "#E2F0E0" },
  badgeText: { fontSize: 10, color: "#536146" },
  detail: {
    borderTopWidth: 1,
    borderTopColor: "#E8EDE3",
    paddingTop: 16,
    gap: 9,
  },
  code: {
    fontSize: 15,
    fontWeight: "700",
    color: "#244F37",
    padding: 12,
    backgroundColor: "#F1F5E9",
    borderRadius: 8,
  },
  reviewReason: { fontSize: 12, lineHeight: 18, color: "#8B6A32" },
  empty: {
    alignItems: "center",
    paddingHorizontal: 24,
    paddingVertical: 32,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: "#C9D4C2",
    borderRadius: 18,
    gap: 14,
  },
  emptyMark: {
    width: 50,
    height: 50,
    borderRadius: 16,
    backgroundColor: "#E4EBDD",
    alignItems: "center",
    justifyContent: "center",
  },
  emptyIcon: { fontSize: 30, color: "#789168" },
  emptyTitle: {
    fontSize: 17,
    fontWeight: "700",
    textAlign: "center",
    color: "#3A5941",
  },
  emptyText: {
    fontSize: 13,
    lineHeight: 22,
    textAlign: "center",
    color: "#7A8777",
  },
  inbox: { backgroundColor: "#E9EFE0", padding: 20, borderRadius: 16, gap: 10 },
  address: {
    fontSize: 13,
    lineHeight: 20,
    color: "#285238",
    fontWeight: "600",
  },
  errorBox: {
    backgroundColor: "#FBECE6",
    padding: 16,
    borderRadius: 12,
    gap: 10,
  },
  error: { color: "#9F342C", lineHeight: 20 },
  footer: {
    textAlign: "center",
    fontSize: 11,
    color: "#94A08E",
    marginTop: 20,
  },
  toggle: { flexDirection: "row", alignItems: "center", gap: 12 },
  evidence: {
    padding: 14,
    backgroundColor: "#F5F7F1",
    borderRadius: 10,
    gap: 8,
  },
  emailOption: {
    padding: 12,
    borderWidth: 1,
    borderColor: "#DEE5D7",
    borderRadius: 10,
  },
  emailSelected: { borderColor: "#1B5E46", backgroundColor: "#ECF2E8" },
});
