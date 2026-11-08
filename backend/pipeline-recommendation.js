const {
  inferPipelineIntent,
  judgePipelineWorld,
} = require("./pipeline-language");
const {
  buildWorld,
  checkOptimizerAgainstGuards,
} = require("./optimizer-world");
const { loadOwnerData } = require("./pipeline-data");
const { spentInPeriod } = require("./budget-derive");
const { hash } = require("./pipeline-utils");
function convertOffer(row) {
  const t = row.terms,
    kind =
      t.benefit.type === "fixed_discount"
        ? "amount_off"
        : t.benefit.type === "percent"
          ? "percent_off"
          : t.benefit.type === "cashback"
            ? t.benefit.rateBps
              ? "cashback_percent"
              : "cashback_amount"
            : null;
  if (!kind || row.eligibility?.result !== "eligible") return null;
  return {
    id: row.id,
    source:
      row.provenance === "synthetic_fixture" ? "synthetic_fixture" : "deals",
    provenance: row.provenance,
    merchant_id: row.merchant_id,
    terms_text: t.title,
    kind,
    value: t.benefit.rateBps ?? t.benefit.amountMinor,
    min_spend:
      t.minSpendMinor == null
        ? null
        : { minor: t.minSpendMinor, currency: "USD" },
    max_benefit:
      t.benefit.capMinor == null
        ? null
        : { minor: t.benefit.capMinor, currency: "USD" },
    starts_at: t.validFrom,
    expires_at: t.expiresAt,
    required_payment_method_ids:
      row.kind === "card_linked_offer" ? ["card"] : [],
    stack_group: row.kind === "card_linked_offer" ? "card_linked" : null,
    stackable: t.stacking === "allowed",
    verified: true,
    cashback_delay_days: kind.startsWith("cashback") ? 30 : 0,
  };
}
async function recommendPipeline(
  db,
  ownerId,
  request,
  {
    env = process.env,
    deals,
    fetchImpl = fetch,
    now = new Date(),
    plansForOwner = async () => ({}),
  } = {},
) {
  const skip = (reason) => ({ recommendation: null, reason });
  const data = await loadOwnerData(
    db,
    ownerId,
    now,
    await plansForOwner(ownerId),
  );
  if (!data?.bank) return skip("profile_required");
  await require("./nearby-merchants").cacheNearbyMerchants(db, request, now);
  if (!env.OPTIMIZER_API_URL || !env.OPTIMIZER_API_KEY)
    return skip("optimizer_unavailable");
  let preview = buildWorld({ ...data, request, now });
  let inferredIntent = null;
  if (preview.reason === "no_matching_routine") {
    inferredIntent = await inferPipelineIntent(preview.candidates, {
      env,
      fetchImpl,
    });
    if (inferredIntent)
      preview = buildWorld({ ...data, request, now, inferredIntent });
  }
  if (preview.reason) return skip(preview.reason);
  let offers = [],
    loyalty = [];
  if (deals) {
    const programs = await deals.catalog(ownerId);
    const status = await deals.status(ownerId);
    if (status.consented) {
      const enrollments = await deals.request(ownerId, "/v1/deals/enrollments");
      loyalty = programs.map((p) => {
        const e = enrollments.find((e) => e.program_id === p.id);
        return {
          ...p,
          enrolled:
            e?.state === "enrolled" && !e.suppressed_at && !e.opted_out_at,
          simulated: e?.simulated,
        };
      });
      if (preview.reason) return skip(preview.reason);
      for (const item of preview.world.items) {
        const place = preview.world.places.find((p) => p.id === item.place_id);
        const result = await deals.request(
          ownerId,
          "/v1/deals/candidates",
          "POST",
          {
            merchantIds: [place.merchant_id],
            channel: "in_store",
            branchId: place.id,
            eligibleSpendMinor: item.price.minor,
            paymentMethod: "Capital One Card",
            product: "*",
            membershipVerified: loyalty.some(
              (l) => l.merchant_id === place.merchant_id && l.enrolled,
            ),
            useWithOtherOffers: true,
          },
          "deals:optimizer",
        );
        offers.push(
          ...result.candidates
            .map(convertOffer)
            .filter(Boolean)
            .map((o) => ({ ...o, eligible_item_ids: [item.id] })),
        );
      }
    }
  }
  const built = buildWorld({
    ...data,
    request,
    offers,
    loyalty,
    now,
    inferredIntent,
    allowFixtures: env.DEALS_ALLOW_TEST_FIXTURES === "1",
  });
  if (built.reason) return skip(built.reason);
  const { world, meta } = built;
  await judgePipelineWorld(world, { env, fetchImpl });
  let result;
  try {
    const origin = new URL(env.OPTIMIZER_API_URL);
    if (
      origin.username ||
      origin.password ||
      origin.search ||
      origin.hash ||
      origin.pathname !== "/" ||
      (origin.protocol !== "https:" &&
        !(
          origin.protocol === "http:" &&
          ["127.0.0.1", "localhost", "[::1]"].includes(origin.hostname)
        ))
    )
      return skip("optimizer_unavailable");
    const res = await fetchImpl(
      new URL("/internal/v1/optimizer/evaluate", origin),
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": env.OPTIMIZER_API_KEY,
        },
        body: JSON.stringify(world),
        redirect: "error",
        signal: AbortSignal.timeout(5000),
      },
    );
    if (!res.ok) return skip("optimizer_unavailable");
    result = await res.json();
  } catch {
    return skip("optimizer_unavailable");
  }
  if (!checkOptimizerAgainstGuards(result, world, meta, now))
    return skip("optimizer_mismatch");
  if (!result.chosen)
    return {
      ...skip(
        result.rejections?.some((r) => r.stage === "budget")
          ? "budget_limit"
          : "no_eligible_offer",
      ),
      explanation: "No affordable alternative was verified.",
    };
  if (!result.ranked.some((r) => hash(r) === hash(result.chosen)))
    return skip("optimizer_mismatch");
  const current = await loadOwnerData(
    db,
    ownerId,
    new Date(),
    await plansForOwner(ownerId),
  );
  if (
    !current?.forecast ||
    current.profile.profileVersion !== data.profile.profileVersion ||
    current.profile.memoryVersion !== data.profile.memoryVersion ||
    Date.now() > Date.parse(result.expires_at)
  )
    return skip("refresh_required");
  const chosen = result.chosen,
    place = world.places.find((p) => p.id === chosen.place_id),
    pm = world.payment_methods.find((p) => p.id === chosen.payment_method_id);
  if (!pm) return skip("optimizer_mismatch");
  const applied = chosen.applied_offer_ids
      .map((id) => world.offers.find((o) => o.id === id))
      .filter(Boolean),
    sample = applied.some((o) => o.source === "synthetic_fixture"),
    simulated = applied.some((o) =>
      o.source.startsWith("store_loyalty_simulated:"),
    ),
    synthetic = data.ledger.some((r) => r.provenance === "synthetic_persona");
  const budgetAfter = Object.fromEntries(
    data.budgets
      .filter((b) => b.category === "all" || b.category === place.categories[0])
      .map((b) => [
        b.category,
        Number(b.limit_cents) -
          spentInPeriod(data.ledger, b, now, data.owner.time_zone) -
          chosen.payable_now.minor,
      ]),
  );
  const points = Object.entries(chosen.points || {});
  return {
    callCandidates: result.ranked.map((r) => ({
      id: r.place_id,
      merchant: r.place_name,
      category: world.items.find((i) => i.id === r.item_id).category,
      payableCents: r.payable_now.minor,
      cashbackCents: r.verified_cashback.minor,
      effectiveCostCents: r.effective_cost.minor,
    })),
    recommendation: {
      store: {
        brand: place.merchant_id,
        name: place.name,
        distanceM: chosen.distance_m,
      },
      offer: {
        id: place.id,
        merchant: place.name,
        distance: chosen.distance_m,
      },
      routine: {
        weekday:
          request.source === "demo"
            ? "Friday"
            : new Intl.DateTimeFormat("en-US", {
                weekday: "long",
                timeZone: data.owner.time_zone,
              }).format(now),
        daypart: "routine window",
        observedDays: meta.anchor.support?.n || 0,
      },
      payWith: {
        id: pm.id,
        label: pm.name,
        ...(pm.id === "card"
          ? {
              termsUrl: require("../data/card-terms.json").url,
              verifiedOn: require("../data/card-terms.json").verifiedOn,
            }
          : {}),
      },
      profileVersion: data.profile.profileVersion,
      memoryVersion: data.profile.memoryVersion,
      obligationsVersion: data.profile.socialObligations?.version ?? null,
      applied: [
        ...applied.map((o) => ({
          kind: o.source.startsWith("store_loyalty")
            ? "loyalty"
            : "card_linked_offer",
          label: o.terms_text,
          provenance:
            o.source === "synthetic_fixture"
              ? "synthetic_fixture"
              : "public_terms",
        })),
        {
          kind: "card_cashback",
          label: "Card cash back",
          provenance: "public_terms",
        },
      ],
      loyalty: points[0]
        ? {
            program: points[0][0],
            points: points[0][1],
            valued: false,
            simulatedMembership: simulated,
          }
        : null,
      payableCents: chosen.payable_now.minor,
      cashbackCents: chosen.verified_cashback.minor,
      effectiveCostCents: chosen.effective_cost.minor,
      budgetAfter,
      labels: [
        ...(sample ? ["sample_offer"] : []),
        ...(simulated ? ["simulated_signup"] : []),
        ...(synthetic ? ["synthetic_history"] : []),
      ],
      source: request.source,
      expiresAt: Date.parse(result.expires_at),
      explanation: {
        text:
          "Pay $" +
          (chosen.payable_now.minor / 100).toFixed(2) +
          " with " +
          pm.name +
          ". Estimated cost after cashback: $" +
          (chosen.effective_cost.minor / 100).toFixed(2) +
          "." +
          (request.source === "demo" ? " Demo time." : ""),
      },
    },
  };
}
module.exports = { recommendPipeline, convertOffer };
