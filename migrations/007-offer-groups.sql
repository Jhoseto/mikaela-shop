ALTER TABLE offers ADD COLUMN group_id uuid;
ALTER TABLE offers ADD COLUMN max_groups int CHECK(max_groups IS NULL OR max_groups>0);
CREATE INDEX offers_group ON offers(group_id) WHERE group_id IS NOT NULL;

