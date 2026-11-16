export const currentBrochureBatch = `
  SELECT c.id, c.current_batch, c.starts, c.ends, b.source_hash, b.original_url, b.cover_url
  FROM brochure_campaigns c JOIN brochure_batches b ON b.id = c.current_batch
  WHERE (now() AT TIME ZONE 'Europe/Sofia')::date BETWEEN c.starts AND c.ends
    AND b.status = 'success'
  ORDER BY c.starts DESC, b.finished_at DESC, c.id LIMIT 1
`;

// The flyer can be browsed before a shop approves a variant for online sale.
// Keep the public projection tied to the current PDF and its extracted fields.
export const currentBrochureListings = `
  SELECT DISTINCT ON (v.id)
    p.id AS product_id, v.id AS variant_id, active.id AS campaign_id,
    p.available AND v.available AS stock_available, v.online_limit,
    coalesce((i.extracted->>'ambiguous')::boolean,false) AS requires_variant_choice,
    p.source_data->'food'->>'type' AS food_type,
    (p.source_data->>'category_id')::uuid AS category_id,
    i.extracted->>'name' AS name, coalesce(i.extracted->>'brand', '') AS brand,
    coalesce(i.extracted->>'text', '') AS description,
    coalesce(i.extracted->>'pack', '') AS pack, i.extracted->>'unit' AS unit,
    CASE WHEN i.extracted->>'imageUrl' ~
      ('^/media/brochures/' || active.source_hash || '/(v[0-9]+/)?p[0-9]+-i[0-9]+-photo[.]webp$')
      THEN i.extracted->>'imageUrl' END AS image_url,
    (i.extracted->>'priceCents')::integer AS price_cents,
    (i.extracted->>'buy')::integer AS buy, (i.extracted->>'pay')::integer AS pay,
    concat_ws(' · ', nullif(i.extracted->>'terms', ''),
      CASE WHEN i.extracted->>'localOnly' = 'true' THEN 'Само в определени обекти.' END) AS terms,
    coalesce((p.source_data->'food'->>'ageRestricted')::boolean, false) AS age_restricted,
    active.starts, active.ends, i.page, i.ordinal
  FROM (${currentBrochureBatch}) active
  JOIN brochure_items i ON i.batch_id = active.current_batch AND i.status = 'review'
  JOIN brochure_sources s ON s.source_key = i.source_key AND NOT s.excluded
  JOIN variants v ON v.id = s.draft_variant
  JOIN products p ON p.id = v.product_id AND p.origin = 'brochure' AND p.status = 'draft'
    AND p.source_data->>'source_key' = i.source_key
  WHERE NOT EXISTS (SELECT 1 FROM brochure_links l WHERE l.source_key = i.source_key)
  ORDER BY v.id, i.page, i.ordinal, i.id
`;

// The display price and the cart price must come from the same version and dates.
export function datedBrochureListings(campaignParameter: "$3" | "$5") {
  return `SELECT b.*,
    coalesce(b.campaign_id=${campaignParameter}::uuid,false) AS local_brochure_order,
    jsonb_strip_nulls(jsonb_build_object('type',b.food_type,'ageRestricted',b.age_restricted)) AS public_food,
    CASE WHEN $1::date BETWEEN b.starts AND b.ends THEN jsonb_build_object(
      'buy',b.buy,'pay',b.pay,'price_cents',b.price_cents,'terms',b.terms,'starts',b.starts,'ends',b.ends) END AS offer
    FROM (${currentBrochureListings}) b`;
}
