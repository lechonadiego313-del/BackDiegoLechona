-- Destructive rollback: export the dispatch tables before running this file.
BEGIN;
DROP TABLE IF EXISTS dispatch_items;
DROP TABLE IF EXISTS dispatches;
DROP TABLE IF EXISTS dispatch_presentations;
DROP TABLE IF EXISTS dispatch_products;
DROP TYPE IF EXISTS dispatch_status;
DROP TYPE IF EXISTS dispatch_sale_type;
COMMIT;
