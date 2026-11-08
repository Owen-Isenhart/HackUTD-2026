"""Category rewards are checked against the independent full-world oracle."""
from dataclasses import replace
from hypothesis import given, settings, HealthCheck, strategies as st
from optimizer.engine import optimize
from optimizer.models import OfferKind
from . import oracle
from .factories import NOW
from .test_optimality import worlds, rows, CATS

@settings(max_examples=100, deadline=None, suppress_health_check=list(HealthCheck))
@given(worlds(), st.dictionaries(st.sampled_from(CATS),st.integers(0,500),min_size=1,max_size=2))
def test_category_rates_match_independent_oracle(inp,rates):
    methods=[m.model_copy(update={"category_cashback_bps":{c:(v+i*31)%501 for c,v in rates.items()}}) for i,m in enumerate(inp.payment_methods)]
    offers=[offer.model_copy(update={"source":"store_loyalty_simulated:"+offer.id}) if offer.kind is OfferKind.POINTS_PER_DOLLAR else offer for offer in inp.offers]
    inp=replace(inp,payment_methods=methods,offers=offers)
    result=optimize(inp,NOW)
    reference=oracle.recommend(inp,NOW)
    assert result.decision.value==reference.decision
    assert rows(result)==[option.row() for option in reference.ranked]
