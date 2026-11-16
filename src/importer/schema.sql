CREATE TABLE brochure_schedule (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton), interval_hours integer NOT NULL DEFAULT 6 CHECK(interval_hours BETWEEN 1 AND 168),
 last_success timestamptz, last_check timestamptz, next_check timestamptz NOT NULL DEFAULT now(), failures integer NOT NULL DEFAULT 0, last_error text
);
INSERT INTO brochure_schedule(singleton) VALUES(true);
CREATE TABLE brochure_campaigns (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), starts date NOT NULL, ends date NOT NULL CHECK(ends>=starts),
 current_batch uuid, UNIQUE(starts,ends)
);
CREATE TABLE brochure_batches (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), campaign_id uuid REFERENCES brochure_campaigns,
 source_url text NOT NULL, source_hash text, version integer, original_url text, cover_url text,
 status text NOT NULL CHECK(status IN ('processing','success','duplicate','failed')), error text,
 started_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz, stats jsonb NOT NULL DEFAULT '{}', skipped jsonb NOT NULL DEFAULT '[]'
);
ALTER TABLE brochure_campaigns ADD FOREIGN KEY(current_batch) REFERENCES brochure_batches(id);
CREATE INDEX brochure_batches_hash ON brochure_batches(source_hash) WHERE status='success';
CREATE TABLE brochure_sources (
 source_key text PRIMARY KEY, draft_variant uuid REFERENCES variants, excluded boolean NOT NULL DEFAULT false
);
CREATE TABLE brochure_items (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), batch_id uuid NOT NULL REFERENCES brochure_batches, source_key text NOT NULL REFERENCES brochure_sources,
 page integer NOT NULL, ordinal integer NOT NULL, extracted jsonb NOT NULL, old_values jsonb, proposals jsonb NOT NULL DEFAULT '[]',
 status text NOT NULL CHECK(status IN ('review','approved','ignored')), reasons text[] NOT NULL DEFAULT '{}', UNIQUE(batch_id,page,ordinal)
);
CREATE TABLE brochure_links (
 source_key text NOT NULL REFERENCES brochure_sources, variant_id uuid NOT NULL REFERENCES variants, confirmed_by text NOT NULL,
 confirmed_at timestamptz NOT NULL DEFAULT now(), price_cents integer NOT NULL, buy integer NOT NULL, pay integer NOT NULL,
 PRIMARY KEY(source_key,variant_id)
);
CREATE UNIQUE INDEX brochure_variant_campaign ON offers(campaign_id,variant_id) WHERE campaign_id IS NOT NULL;
CREATE TABLE brochure_requests (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), kind text NOT NULL CHECK(kind IN ('check','upload')),
 source_name text NOT NULL DEFAULT '', payload bytea, actor text NOT NULL, status text NOT NULL DEFAULT 'queued',
 tries integer NOT NULL DEFAULT 0, next_at timestamptz NOT NULL DEFAULT now(), created_at timestamptz NOT NULL DEFAULT now(), error text
);
