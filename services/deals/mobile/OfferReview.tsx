import React, { useState } from "react";
import {
  Pressable,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import type { Terms } from "../src/contracts";
import { request, type Offer, type Session } from "./api";

/** Review is an explicit user attestation. It never runs from email content or a model proposal. */
export function OfferReview({
  offer,
  sourceText,
  session,
  onSaved,
}: {
  offer: Offer;
  sourceText: string;
  session: Session;
  onSaved: () => Promise<void>;
}) {
  const original = offer.terms as Terms;
  const [products, setProducts] = useState(original.products?.join(", ") ?? ""),
    [channels, setChannels] = useState(original.channels ?? []);
  const [expires, setExpires] = useState(original.expiresAt ?? ""),
    [membership, setMembership] = useState(original.membershipRequired ?? null);
  const [activation, setActivation] = useState(
      original.activationRequired ?? null,
    ),
    [newCustomer, setNewCustomer] = useState(original.newCustomerOnly ?? null);
  const [scopeQuote, setScopeQuote] = useState(""),
    [expiryQuote, setExpiryQuote] = useState(
      original.evidence?.expiresAt?.quote ?? "",
    );
  const [requirementsQuote, setRequirementsQuote] = useState(""),
    [note, setNote] = useState(""),
    [verified, setVerified] = useState(false);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [minimum, setMinimum] = useState(
    original.minSpendMinor === null ? "" : String(original.minSpendMinor / 100),
  );
  const [minimumQuote, setMinimumQuote] = useState(
    original.evidence?.minSpendMinor?.quote ?? "",
  );
  const [payment, setPayment] = useState(original.paymentRequirement ?? "");
  const knownBenefit = original.benefit?.type !== "unsupported";
  function span(quote: string) {
    const start = sourceText.indexOf(quote);
    if (!quote || start < 0)
      throw new Error(
        "Each supporting quote must occur exactly in the source email.",
      );
    return { start, end: start + quote.length, quote };
  }
  async function save() {
    setBusy(true);
    try {
      if (!verified)
        throw new Error(
          "Confirm that you checked the sender and complete terms.",
        );
      if (!knownBenefit)
        throw new Error(
          "This benefit needs further interpretation. Keep it in review.",
        );
      if (!products.trim() || !channels.length)
        throw new Error(
          "Enter eligible products and choose at least one channel.",
        );
      if (
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(Z|[+-]\d{2}:\d{2})$/.test(
          expires,
        )
      )
        throw new Error(
          "Enter the exact expiration time with its timezone offset. Leave uncertain dates in review.",
        );
      if (membership === null || activation === null || newCustomer === null)
        throw new Error(
          "Review every requirement before activating this offer.",
        );
      if (note.trim().length < 10)
        throw new Error("Add a short note describing what you verified.");
      const scope = span(scopeQuote),
        requirements = span(requirementsQuote);
      if (!/^\d+(?:\.\d{1,2})?$/.test(minimum))
        throw new Error(
          "Enter the verified minimum spend in USD, or 0 only when no minimum is verified.",
        );
      const [whole, fraction = ""] = minimum.split(".");
      const minor = BigInt(whole!) * 100n + BigInt(fraction.padEnd(2, "0"));
      if (minor > BigInt(Number.MAX_SAFE_INTEGER))
        throw new Error("Minimum spend is too large.");
      const terms: Terms = {
        ...original,
        products: products
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
        channels,
        expiresAt: expires,
        expirySemantics: "exclusive_instant",
        membershipRequired: membership,
        activationRequired: activation,
        newCustomerOnly: newCustomer,
        minSpendMinor: Number(minor),
        paymentRequirement: payment.trim() || null,
        evidence: {
          ...original.evidence,
          products: scope,
          channels: scope,
          expiresAt: span(expiryQuote),
          membershipRequired: requirements,
          activationRequired: requirements,
          newCustomerOnly: requirements,
          paymentRequirement: requirements,
          minSpendMinor: span(minimumQuote),
        },
        parserVersion: "user-reviewed-v1",
      };
      await request(session, `/offers/${offer.id}/review`, {
        method: "POST",
        body: JSON.stringify({
          revision: offer.revision,
          terms,
          senderVerified: true,
          evidenceConfirmed: true,
          note,
        }),
      });
      await onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Review could not be saved");
    } finally {
      setBusy(false);
    }
  }
  return (
    <View style={s.form}>
      <Text style={s.heading}>Review the complete terms</Text>
      <Text style={s.note}>
        Only confirm facts supported by the merchant’s email. An uncertain offer
        can stay in review. “Up to” benefits and unsupported formulas cannot
        become guaranteed savings.
      </Text>
      {!knownBenefit && (
        <Text style={s.error}>
          This formula needs additional interpretation. Keep it in review.
        </Text>
      )}
      <Field
        label="Eligible products (comma separated)"
        value={products}
        set={setProducts}
      />
      <Text style={s.label}>Eligible purchase channels</Text>
      <View style={s.options}>
        {(["online", "in_store", "in_app", "pickup"] as const).map((c) => (
          <Pressable
            accessibilityRole="checkbox"
            accessibilityState={{ checked: channels.includes(c) }}
            key={c}
            onPress={() =>
              setChannels(
                channels.includes(c)
                  ? channels.filter((v) => v !== c)
                  : [...channels, c],
              )
            }
            style={[s.option, channels.includes(c) && s.selected]}
          >
            <Text style={s.optionText}>{c.replaceAll("_", " ")}</Text>
          </Pressable>
        ))}
      </View>
      <Field
        label="Exact source quote for product and channel eligibility"
        value={scopeQuote}
        set={setScopeQuote}
        multiline
      />
      <Field
        label="Expiration including timezone (e.g. 2026-11-12T23:59:59-06:00)"
        value={expires}
        set={setExpires}
      />
      <Field
        label="Exact source quote for expiration"
        value={expiryQuote}
        set={setExpiryQuote}
        multiline
      />
      <Choice
        label="Loyalty membership required"
        value={membership}
        set={setMembership}
      />
      <Choice
        label="Offer activation required"
        value={activation}
        set={setActivation}
      />
      <Choice
        label="New customers only"
        value={newCustomer}
        set={setNewCustomer}
      />
      <Field
        label="Verified minimum eligible spend (USD; 0 only if no minimum)"
        value={minimum}
        set={setMinimum}
      />
      <Field
        label="Exact source quote supporting the minimum-spend rule"
        value={minimumQuote}
        set={setMinimumQuote}
        multiline
      />
      <Field
        label="Required payment method (leave blank only if no requirement is verified)"
        value={payment}
        set={setPayment}
      />
      <Field
        label="Exact source quote supporting these requirements"
        value={requirementsQuote}
        set={setRequirementsQuote}
        multiline
      />
      <Field
        label="What did you verify?"
        value={note}
        set={setNote}
        multiline
      />
      <View style={s.toggle}>
        <Switch
          accessibilityLabel="I verified the merchant sender and all conditions"
          value={verified}
          onValueChange={setVerified}
        />
        <Text style={s.note}>
          I verified the merchant sender and complete conditions, including
          exclusions and payment requirements.
        </Text>
      </View>
      {!!error && (
        <Text accessibilityRole="alert" style={s.error}>
          {error}
        </Text>
      )}
      <Pressable
        accessibilityRole="button"
        disabled={busy || !knownBenefit || !verified}
        onPress={save}
        style={[s.button, (busy || !knownBenefit || !verified) && s.disabled]}
      >
        <Text style={s.buttonText}>
          {busy ? "Saving…" : "Save evidence review"}
        </Text>
      </Pressable>
    </View>
  );
}
function Field({
  label,
  value,
  set,
  multiline = false,
}: {
  label: string;
  value: string;
  set: (s: string) => void;
  multiline?: boolean;
}) {
  return (
    <View style={s.field}>
      <Text style={s.label}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={set}
        multiline={multiline}
        autoCapitalize="none"
        style={[s.input, multiline && s.multiline]}
      />
    </View>
  );
}
function Choice({
  label,
  value,
  set,
}: {
  label: string;
  value: boolean | null;
  set: (v: boolean | null) => void;
}) {
  return (
    <View style={s.field}>
      <Text style={s.label}>{label}</Text>
      <View style={s.options}>
        {[
          { label: "Unknown", value: null },
          { label: "Yes", value: true },
          { label: "No", value: false },
        ].map((o) => (
          <Pressable
            accessibilityRole="radio"
            accessibilityState={{ checked: value === o.value }}
            key={o.label}
            onPress={() => set(o.value)}
            style={[s.option, value === o.value && s.selected]}
          >
            <Text style={s.optionText}>{o.label}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}
const s = StyleSheet.create({
  form: { gap: 14, paddingTop: 16 },
  heading: { fontSize: 16, fontWeight: "700", color: "#203D31" },
  note: { fontSize: 12, lineHeight: 19, color: "#68776B", flexShrink: 1 },
  label: { fontSize: 11, fontWeight: "600", color: "#355240" },
  field: { gap: 7 },
  input: {
    borderWidth: 1,
    borderColor: "#D5DED1",
    borderRadius: 9,
    padding: 12,
    fontSize: 13,
    color: "#203D31",
    backgroundColor: "#FFF",
  },
  multiline: { minHeight: 70, textAlignVertical: "top" },
  options: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  option: {
    borderRadius: 8,
    padding: 9,
    borderWidth: 1,
    borderColor: "#D5DED1",
  },
  selected: { backgroundColor: "#DFECDA", borderColor: "#54835D" },
  optionText: { fontSize: 12, color: "#355240" },
  toggle: { flexDirection: "row", alignItems: "center", gap: 10 },
  error: { fontSize: 12, lineHeight: 19, color: "#9F342C" },
  button: {
    backgroundColor: "#1B5E46",
    padding: 14,
    borderRadius: 10,
    alignItems: "center",
  },
  buttonText: { color: "#FFF", fontWeight: "700", fontSize: 13 },
  disabled: { opacity: 0.4 },
});
