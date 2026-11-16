-- Consistent trigram keys even on Windows clusters initialized with locale C.
CREATE FUNCTION shop_search_key(value text) RETURNS text LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS $$
 WITH folded AS (
 SELECT translate(lower(value),'АБВГДЕЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЬЮЯ','абвгдежзийклмнопрстуфхцчшщъьюя') AS s
 ), expanded AS (
 SELECT replace(replace(replace(replace(replace(replace(replace(replace(replace(s,
 'щ','sht'),'ш','sh'),'ч','ch'),'ж','zh'),'ц','ts'),'х','h'),'ю','yu'),'я','ya'),'ь','y') AS s FROM folded
 )
 SELECT translate(s,'абвгдезийклмнопрстуфъ','abvgdeziyklmnoprstufa') FROM expanded
$$;
CREATE INDEX product_search_key ON products USING gin(shop_search_key(brand || ' ' || name) gin_trgm_ops);

