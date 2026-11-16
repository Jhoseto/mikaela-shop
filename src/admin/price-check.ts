// This predicate is reused in the dashboard and product list. Its caller defines v as a variant.
export const priceNeedsReview = `(
 (v.regular_cents is null and (v.local_cents is null or v.local_until < (now() at time zone 'Europe/Sofia')::date)
  and not exists(select 1 from offers o where o.variant_id=v.id and o.approved and o.price_cents is not null and (now() at time zone 'Europe/Sofia')::date between o.starts and o.ends))
 or (v.local_cents is not null and (v.local_until is null or v.local_until >= (now() at time zone 'Europe/Sofia')::date)
  and exists(select 1 from offers o where o.variant_id=v.id and o.approved and o.campaign_id is not null and o.price_cents<v.local_cents and (now() at time zone 'Europe/Sofia')::date between o.starts and o.ends))
)`;
