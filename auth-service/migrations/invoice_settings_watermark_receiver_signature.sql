-- Adds two more printable images to tbl_invoice_settings, each a toggle plus
-- an uploaded image, on the same contract as the authorised signature
-- (see invoice_settings_signature_url.sql):
--
--   * Watermark          — a faded image printed behind the invoice body.
--                          With no image uploaded the invoice falls back to
--                          the company logo.
--   * Receiver signature — printed on the left, opposite the authorised
--                          signature. With no image uploaded the invoice
--                          prints an empty "Receiver's Signature" line.
--
-- The *_url columns hold a MinIO URL (POST .../watermark and
-- .../receiver-signature), never the image bytes. NULL means "none uploaded".
--
-- Run this once against the retail_auth_service database.
-- Safe to re-run: uses ADD COLUMN IF NOT EXISTS.

ALTER TABLE tbl_invoice_settings
    ADD COLUMN IF NOT EXISTS show_watermark          BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS watermark_url           TEXT,
    ADD COLUMN IF NOT EXISTS show_receiver_signature BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS receiver_signature_url  TEXT;
