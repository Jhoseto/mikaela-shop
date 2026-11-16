ALTER TABLE claims ADD COLUMN item_details jsonb NOT NULL DEFAULT '[]';

UPDATE claims c SET item_details = (
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', i.id, 'variantId', coalesce(s.data->>'variantId', i.variant_id::text),
    'productName', s.data->>'productName', 'variantName', s.data->>'variantName', 'pack', s.data->>'pack'
  ) ORDER BY a.ordinal), '[]'::jsonb)
  FROM unnest(c.item_ids) WITH ORDINALITY a(id,ordinal)
  JOIN order_items i ON i.id=a.id AND i.order_id=c.order_id
  CROSS JOIN LATERAL (SELECT coalesce(i.change_detail->'prepared',i.snapshot) AS data) s
);
