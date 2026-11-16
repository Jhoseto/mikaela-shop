-- Only local stock already confirmed by staff is subject to the participating
-- national price cap. Keep unaccepted matches and excluded items out of checkout.
CREATE VIEW brochure_conflicts AS
WITH mapped AS (
  SELECT source_key,variant_id FROM brochure_links
  UNION
  SELECT s.source_key,s.draft_variant
    FROM brochure_sources s JOIN variants v ON v.id=s.draft_variant JOIN products p ON p.id=v.product_id
    WHERE p.local_settings @> '{"localApproved":true}'
)
SELECT DISTINCT v.id AS variant_id,c.starts,least(c.ends,coalesce(v.local_until,c.ends)) AS ends
FROM brochure_campaigns c
JOIN brochure_items i ON i.batch_id=c.current_batch AND i.status<>'ignored'
JOIN brochure_sources s ON s.source_key=i.source_key AND NOT s.excluded
JOIN mapped m ON m.source_key=i.source_key
JOIN variants v ON v.id=m.variant_id
LEFT JOIN offers o ON o.campaign_id=c.id AND o.variant_id=v.id AND o.approved
WHERE v.local_cents IS NOT NULL
  AND (v.local_until IS NULL OR v.local_until>=c.starts)
  AND (v.local_cents>coalesce(o.price_cents,(i.extracted->>'priceCents')::integer)
       OR coalesce(o.buy,(i.extracted->>'buy')::integer)>1);
