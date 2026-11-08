import React, { useEffect, useState } from "react";
import { Pressable, StyleSheet, Switch, Text, View } from "react-native";
import {
  human,
  openMerchant,
  request,
  type Program,
  type Enrollment,
  type EnrollmentFlowState,
  type Session,
} from "./api";

export function EnrollmentFlow({
  session,
  enrollments,
  onChange,
}: {
  session: Session;
  enrollments: Enrollment[];
  onChange: () => Promise<void>;
}) {
  const [programs, setPrograms] = useState<Program[]>([]),
    [flow, setFlow] = useState<EnrollmentFlowState | null>(null);
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [promotionsOnly, setPromotionsOnly] = useState(false);
  useEffect(() => {
    const abort = new AbortController();
    request<Program[]>(session, "/programs", { signal: abort.signal })
      .then(setPrograms)
      .catch((e) => {
        if (!abort.signal.aborted) setError(e.message);
      });
    return () => abort.abort();
  }, [session]);
  async function act(fn: () => Promise<EnrollmentFlowState>) {
    setBusy(true);
    try {
      setFlow(await fn());
      setError("");
      await onChange();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Unable to continue registration",
      );
    } finally {
      setBusy(false);
    }
  }
  const post = (path: string, body: unknown) =>
    request<EnrollmentFlowState>(session, path, {
      method: "POST",
      body: JSON.stringify(body),
    });
  function start(p: Program) {
    const existing = enrollments.find((e) => e.program_id === p.id);
    return act(() =>
      existing
        ? request(session, `/enrollments/${existing.id}/flow`)
        : post("/enrollments", {
            programId: p.id,
            existingMembership: "unknown",
            intent: promotionsOnly
              ? "promotions_only"
              : "loyalty_and_promotions",
          }),
    );
  }
  async function open() {
    if (!flow) return;
    setBusy(true);
    try {
      await openMerchant(flow.url);
      if (
        ["verification_pending", "outcome_unknown", "confirmed"].includes(
          flow.signupStatus,
        )
      )
        return;
      setFlow(
        await post(`/enrollments/${flow.enrollmentId}/attempt`, {
          expectedVersion: flow.version,
          outcome: "opened",
          existingMembershipChecked: true,
        }),
      );
      await onChange();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Merchant page unavailable");
    } finally {
      setBusy(false);
    }
  }
  return (
    <View style={s.card}>
      <Text style={s.heading}>Register merchant rewards</Text>
      <Text style={s.body}>
        Choose a supported merchant. We’ll preserve one enrollment and your
        promotional address across signup and verification.
      </Text>
      <View style={s.row}>
        <Switch
          accessibilityLabel="Request promotional emails only"
          value={promotionsOnly}
          onValueChange={setPromotionsOnly}
          disabled={busy}
        />
        <Text style={s.body}>Request promotional emails only</Text>
      </View>
      <View style={s.row}>
        {programs.map((p) => (
          <Control
            key={p.id}
            label={p.name}
            disabled={busy}
            action={() => start(p)}
          />
        ))}
      </View>
      {flow && (
        <View style={s.flow}>
          <Text style={s.heading}>{flow.merchant}</Text>
          <Text style={s.body}>Next: {human(flow.nextAction)}</Text>
          <Text selectable style={s.address}>
            {flow.promotionalAddress}
          </Text>
          <Text style={s.note}>
            Use this promotional address for merchant email. Complete identity
            and verification steps required by the merchant. Confirmations will
            appear below when received.
          </Text>
          <Text style={s.note}>
            Requested: {human(flow.intent)}. Merchant requirements may include a
            loyalty account even when you only want promotional emails.
          </Text>
          {[
            "complete_unsubscribe",
            "resume_requires_explicit_consent",
          ].includes(flow.nextAction) ? (
            <Text style={s.note}>
              Promotions are stopped. Use this merchant’s controls below to
              complete unsubscribe or explicitly resume.
            </Text>
          ) : flow.existingMembership === "unknown" ? (
            <>
              <Text style={s.body}>Do you already have a membership?</Text>
              <View style={s.row}>
                <Control
                  label="Yes, use my account"
                  disabled={busy}
                  action={() =>
                    act(() =>
                      post(
                        `/enrollments/${flow.enrollmentId}/existing-membership`,
                        {
                          expectedVersion: flow.version,
                          existingMembership: "yes",
                        },
                      ),
                    )
                  }
                />
                <Control
                  label="No, create one"
                  disabled={busy}
                  action={() =>
                    act(() =>
                      post(
                        `/enrollments/${flow.enrollmentId}/existing-membership`,
                        {
                          expectedVersion: flow.version,
                          existingMembership: "no",
                        },
                      ),
                    )
                  }
                />
              </View>
            </>
          ) : (
            <>
              <Text style={s.note}>
                Required: {flow.requiredInputs.map(human).join(", ")}.
              </Text>
              {flow.instructions && (
                <View style={{ marginVertical: 4 }}>
                  {flow.instructions.map((inst, idx) => (
                    <Text key={idx} style={s.note}>
                      {inst}
                    </Text>
                  ))}
                </View>
              )}
              <Control
                label={
                  flow.safeToCreateAccount
                    ? "Continue signup at merchant ↗"
                    : "Check existing account / preferences ↗"
                }
                disabled={busy}
                action={open}
              />
              {![
                "verification_pending",
                "outcome_unknown",
                "confirmed",
              ].includes(flow.signupStatus) && (
                <>
                  <Control
                    label="I submitted the merchant form"
                    disabled={busy}
                    action={() =>
                      act(() =>
                        post(`/enrollments/${flow.enrollmentId}/attempt`, {
                          expectedVersion: flow.version,
                          outcome: "submitted",
                          existingMembershipChecked: true,
                        }),
                      )
                    }
                  />
                  <Control
                    label="Submission outcome is unclear"
                    disabled={busy}
                    action={() =>
                      act(() =>
                        post(`/enrollments/${flow.enrollmentId}/attempt`, {
                          expectedVersion: flow.version,
                          outcome: "uncertain",
                          existingMembershipChecked: true,
                        }),
                      )
                    }
                  />
                </>
              )}
              {["verification_pending", "outcome_unknown"].includes(
                flow.signupStatus,
              ) && (
                <Text style={s.note}>
                  The submission is unconfirmed. Check the existing account and
                  incoming confirmation email before another signup attempt. Use
                  “Verify my outcome” on the merchant card after verification.
                </Text>
              )}
              <Text style={s.note}>Outcome: {human(flow.externalOutcome)}</Text>
            </>
          )}
        </View>
      )}
      {!!error && (
        <Text accessibilityRole="alert" style={s.error}>
          {error}
        </Text>
      )}
    </View>
  );
}
function Control({
  label,
  action,
  disabled,
}: {
  label: string;
  action: () => void;
  disabled: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={action}
      style={[s.button, disabled && s.disabled]}
    >
      <Text style={s.buttonText}>{label}</Text>
    </Pressable>
  );
}
const s = StyleSheet.create({
  card: {
    padding: 20,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "#D5DED1",
    backgroundColor: "#FFF",
    gap: 14,
  },
  heading: { fontSize: 17, fontWeight: "700", color: "#203D31" },
  body: { fontSize: 14, lineHeight: 22, color: "#56675B" },
  note: { fontSize: 12, lineHeight: 19, color: "#778374" },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  flow: {
    gap: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: "#E0E8DB",
  },
  address: { fontSize: 12, fontWeight: "700", color: "#285238" },
  button: { backgroundColor: "#EAF1E4", padding: 12, borderRadius: 10 },
  buttonText: { fontSize: 12, fontWeight: "700", color: "#355240" },
  disabled: { opacity: 0.45 },
  error: { fontSize: 12, lineHeight: 19, color: "#9F342C" },
});
