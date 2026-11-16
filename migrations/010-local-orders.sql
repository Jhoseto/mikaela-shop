ALTER TABLE delivery_zones ADD COLUMN test_only boolean NOT NULL DEFAULT false;
ALTER TABLE orders ADD COLUMN test_only boolean NOT NULL DEFAULT false;
