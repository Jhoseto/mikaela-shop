-- A lower booking limit applies immediately while existing bookings remain valid.
ALTER TABLE delivery_slots
  DROP CONSTRAINT delivery_slots_check,
  ADD CONSTRAINT delivery_slots_reserved_nonnegative CHECK (reserved >= 0);

CREATE FUNCTION check_new_delivery_reservation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.reserved > NEW.capacity AND (TG_OP = 'INSERT' OR NEW.reserved > OLD.reserved) THEN
    RAISE EXCEPTION 'Delivery slot capacity exceeded'
      USING ERRCODE = '23514', CONSTRAINT = 'delivery_slots_new_reservation_limit';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER delivery_slots_new_reservation_limit
  BEFORE INSERT OR UPDATE OF reserved ON delivery_slots
  FOR EACH ROW EXECUTE FUNCTION check_new_delivery_reservation();

-- Restore the operator's configured limits for future slots created before this change.
UPDATE delivery_slots s
SET capacity = r.capacity, active = r.capacity > 0
FROM delivery_rules r
WHERE s.zone_id = r.zone_id AND extract(isodow FROM s.day) = r.weekday
  AND s.start_time = r.start_time AND s.end_time = r.end_time
  AND s.day >= (now() AT TIME ZONE 'Europe/Sofia')::date
  AND s.capacity <> r.capacity;
