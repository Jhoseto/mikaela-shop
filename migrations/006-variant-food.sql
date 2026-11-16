ALTER TABLE variants ADD COLUMN food jsonb NOT NULL DEFAULT '{}';
CREATE FUNCTION log_offer_price() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN
 INSERT INTO price_history(variant_id,changes) VALUES(OLD.variant_id,jsonb_build_object('offerRemoved',OLD.id));
 RETURN OLD;
 END IF;
 IF TG_OP='INSERT' OR NEW IS DISTINCT FROM OLD THEN
 INSERT INTO price_history(variant_id,changes) VALUES(NEW.variant_id,jsonb_build_object('offer',NEW.id,'cents',NEW.price_cents,'starts',NEW.starts,'ends',NEW.ends,'approved',NEW.approved,'buy',NEW.buy,'pay',NEW.pay));
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER offer_price_history AFTER INSERT OR UPDATE OR DELETE ON offers FOR EACH ROW EXECUTE FUNCTION log_offer_price();

