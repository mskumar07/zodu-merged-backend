-- auth-service — file-service ids for the company logo and invoice images.
-- The *_url columns stay (they hold the stable /files/v/<id> link, and old
-- /auth/file/<key> URLs until the Phase 3 data migration); *_file_id owns the
-- file. Idempotent.

ALTER TABLE tbl_business
    ADD COLUMN IF NOT EXISTS company_logo_file_id UUID;

ALTER TABLE tbl_invoice_settings
    ADD COLUMN IF NOT EXISTS signature_file_id          UUID,
    ADD COLUMN IF NOT EXISTS watermark_file_id          UUID,
    ADD COLUMN IF NOT EXISTS receiver_signature_file_id UUID;
