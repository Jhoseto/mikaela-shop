CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE TABLE categories (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), slug text UNIQUE NOT NULL, name text NOT NULL, sort_order integer NOT NULL DEFAULT 0, image_url text NOT NULL DEFAULT '');
CREATE TABLE products (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),slug text UNIQUE NOT NULL,name text NOT NULL,brand text NOT NULL DEFAULT '',category_id uuid REFERENCES categories,
 origin text NOT NULL DEFAULT 'local' CHECK(origin IN ('local','brochure')), status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','published','hidden','archived')),
 description text NOT NULL DEFAULT '', food jsonb NOT NULL DEFAULT '{}',local_settings jsonb NOT NULL DEFAULT '{}',source_data jsonb NOT NULL DEFAULT '{}', available boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX product_name_trgm ON products USING gin(name gin_trgm_ops);
CREATE TABLE variants (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),product_id uuid NOT NULL REFERENCES products,name text NOT NULL, pack text NOT NULL DEFAULT '',unit text NOT NULL DEFAULT 'piece' CHECK(unit IN ('piece','kg')),regular_cents int CHECK(regular_cents>=0),local_cents int CHECK(local_cents>=0),local_until date,available boolean NOT NULL DEFAULT true,online_limit numeric(12,3) CHECK(online_limit>=0),barcode text);
CREATE UNIQUE INDEX variant_barcode ON variants(barcode) WHERE barcode IS NOT NULL AND barcode<>'';
CREATE TABLE images (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),product_id uuid NOT NULL REFERENCES products,url text NOT NULL,source text NOT NULL DEFAULT 'local' CHECK(source IN ('local','brochure')),sort_order int NOT NULL DEFAULT 0);
CREATE TABLE offers (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),variant_id uuid NOT NULL REFERENCES variants,campaign_id uuid,starts date NOT NULL,ends date NOT NULL,price_cents int CHECK(price_cents>=0),buy int NOT NULL DEFAULT 1,pay int NOT NULL DEFAULT 1,terms text NOT NULL DEFAULT '',approved boolean NOT NULL DEFAULT false,CHECK(ends>=starts AND buy>=1 AND pay>=0 AND pay<=buy));
CREATE INDEX offer_lookup ON offers(variant_id,starts,ends) WHERE approved;
CREATE TABLE price_history (id bigserial PRIMARY KEY,variant_id uuid NOT NULL REFERENCES variants,changes jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
CREATE FUNCTION log_variant_price() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='INSERT' OR OLD.regular_cents IS DISTINCT FROM NEW.regular_cents OR OLD.local_cents IS DISTINCT FROM NEW.local_cents OR OLD.local_until IS DISTINCT FROM NEW.local_until THEN
 INSERT INTO price_history(variant_id,changes) VALUES(NEW.id,jsonb_build_object('regular',NEW.regular_cents,'local',NEW.local_cents,'until',NEW.local_until));
 END IF; RETURN NEW;
END $$;
CREATE TRIGGER variant_price AFTER INSERT OR UPDATE ON variants FOR EACH ROW EXECUTE FUNCTION log_variant_price();
CREATE TABLE synonyms (term text PRIMARY KEY, alternatives text[] NOT NULL);
CREATE TABLE settings (key text PRIMARY KEY,value jsonb NOT NULL);
INSERT INTO settings VALUES ('site','{}');
CREATE TABLE pages(slug text PRIMARY KEY,draft jsonb NOT NULL DEFAULT '{}',published jsonb,version int NOT NULL DEFAULT 0,updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE page_versions(slug text NOT NULL,version int NOT NULL,content jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(slug,version));
CREATE FUNCTION log_publish() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.published IS NOT NULL AND (TG_OP='INSERT' OR NEW.published IS DISTINCT FROM OLD.published OR NEW.version IS DISTINCT FROM OLD.version) THEN
 INSERT INTO page_versions VALUES(NEW.slug,NEW.version,NEW.published,now()) ON CONFLICT DO NOTHING; END IF; RETURN NEW; END $$;
CREATE TRIGGER page_publish AFTER INSERT OR UPDATE ON pages FOR EACH ROW EXECUTE FUNCTION log_publish();
CREATE TABLE staff_roles (user_id text NOT NULL,role text NOT NULL CHECK(role IN ('owner','staff','courier')),PRIMARY KEY(user_id,role));
CREATE TABLE audit_log(id bigserial PRIMARY KEY,actor text,action text NOT NULL,entity text,detail jsonb NOT NULL DEFAULT '{}',created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE delivery_zones(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),name text UNIQUE NOT NULL,active boolean NOT NULL DEFAULT true,min_cents int NOT NULL DEFAULT 0 CHECK(min_cents>=0),fee_cents int NOT NULL DEFAULT 0 CHECK(fee_cents>=0),free_cents int CHECK(free_cents>=0),prep_minutes int NOT NULL DEFAULT 0 CHECK(prep_minutes>=0),cutoff time);
CREATE TABLE delivery_rules(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),zone_id uuid NOT NULL REFERENCES delivery_zones,weekday int NOT NULL CHECK(weekday BETWEEN 1 AND 7),start_time time NOT NULL,end_time time NOT NULL,capacity int NOT NULL CHECK(capacity>=0),CHECK(end_time>start_time),UNIQUE(zone_id,weekday,start_time,end_time));
CREATE TABLE delivery_exceptions(zone_id uuid REFERENCES delivery_zones,day date NOT NULL,closed boolean NOT NULL DEFAULT true,PRIMARY KEY(zone_id,day));
CREATE TABLE delivery_slots(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),zone_id uuid NOT NULL REFERENCES delivery_zones,day date NOT NULL,start_time time NOT NULL,end_time time NOT NULL,capacity int NOT NULL CHECK(capacity>=0),reserved int NOT NULL DEFAULT 0 CHECK(reserved>=0 AND reserved<=capacity),active boolean NOT NULL DEFAULT true,CHECK(end_time>start_time),UNIQUE(zone_id,day,start_time,end_time));
CREATE TABLE orders(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),number bigint GENERATED ALWAYS AS IDENTITY UNIQUE NOT NULL,idempotency_key uuid UNIQUE NOT NULL,request_hash text NOT NULL,token_hash text UNIQUE NOT NULL,
 status text NOT NULL DEFAULT 'new', previous_status text, payment_status text NOT NULL DEFAULT 'pending',payment_method text NOT NULL CHECK(payment_method IN ('cash','card')),customer jsonb NOT NULL,zone_id uuid NOT NULL REFERENCES delivery_zones,slot_id uuid NOT NULL REFERENCES delivery_slots,delivery_snapshot jsonb NOT NULL,
 subtotal_cents int NOT NULL,delivery_cents int NOT NULL,extra_cents int NOT NULL DEFAULT 0,original_cents int NOT NULL,total_cents int NOT NULL,terms_version int NOT NULL,terms_snapshot jsonb NOT NULL,assigned_to text,prepared_by text,capacity_released boolean NOT NULL DEFAULT false,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE order_items(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),order_id uuid NOT NULL REFERENCES orders,variant_id uuid NOT NULL REFERENCES variants,snapshot jsonb NOT NULL,quantity numeric(12,3) NOT NULL,prepared_quantity numeric(12,3),unit_cents int NOT NULL,original_cents int NOT NULL,line_cents int NOT NULL,substitution text NOT NULL,note text NOT NULL DEFAULT '',weight_tolerance numeric(7,3) NOT NULL DEFAULT 0,status text NOT NULL DEFAULT 'requested',change_detail jsonb NOT NULL DEFAULT '{}');
CREATE INDEX order_item_order ON order_items(order_id);
CREATE TABLE order_events(id bigserial PRIMARY KEY,order_id uuid NOT NULL REFERENCES orders,actor text,kind text NOT NULL,detail jsonb NOT NULL DEFAULT '{}',created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE payments(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),order_id uuid NOT NULL REFERENCES orders,amount_cents int NOT NULL,method text NOT NULL,actor text NOT NULL,reason text NOT NULL DEFAULT '',created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE claims(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),order_id uuid NOT NULL REFERENCES orders,kind text NOT NULL,item_ids uuid[] NOT NULL DEFAULT '{}',reason text NOT NULL,contact jsonb NOT NULL DEFAULT '{}',status text NOT NULL DEFAULT 'received',created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE notification_jobs(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),order_id uuid REFERENCES orders,kind text NOT NULL,channel text NOT NULL,payload jsonb NOT NULL DEFAULT '{}',status text NOT NULL DEFAULT 'pending',attempts int NOT NULL DEFAULT 0,next_at timestamptz NOT NULL DEFAULT now(),last_error text,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE worker_state(key text PRIMARY KEY,data jsonb NOT NULL,updated_at timestamptz NOT NULL DEFAULT now());

