-- Update the supplied trial terms only when their published text is untouched.
WITH terms AS (
  SELECT jsonb_build_object(
    'title', 'Условия за локална поръчка',
    'body', 'Поръчката се записва в администрацията на локалния магазин. Доставката и плащането при получаване се изпробват без изпращане на стоки и събиране на пари. Цената и срокът са от брошурата. За теглови стоки сумата е ориентировъчна. При предложение с няколко разновидности посочете желания вкус или разфасовка. Замяна се прави след изрично съгласие.'
  ) AS original, jsonb_build_object(
    'title', 'Условия за пробна поръчка',
    'body', 'При пробна поръчка няма доставка или плащане. Важат цените и сроковете от брошурата. За продуктите на килограм сумата е ориентировъчна. При избор между няколко вкуса или разфасовки посочи желания вариант. Замени се правят само с твое съгласие.'
  ) AS replacement
)
UPDATE pages SET published = terms.replacement,
  draft = CASE WHEN draft = terms.original THEN terms.replacement ELSE draft END,
  version = version + 1, updated_at = now()
FROM terms
WHERE slug = 'lokalni-testovi-usloviya' AND published = terms.original;

UPDATE delivery_zones SET name = 'Район за пробни поръчки'
WHERE test_only AND name = 'Локален тестов район'
  AND NOT EXISTS (SELECT 1 FROM delivery_zones WHERE name = 'Район за пробни поръчки');
