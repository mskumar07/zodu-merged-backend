#!/usr/bin/env bash
#
# Applies every invoice-settings / item-description migration to one environment.
#
#   ./scripts/apply-migrations.sh uat     # runs from anywhere: UAT DB is on a reachable host
#   ./scripts/apply-migrations.sh prod    # RUN ON THE PROD HOST: postgres_prod is docker-internal
#
# Every file is ADD COLUMN IF NOT EXISTS / CREATE OR REPLACE / DROP ... IF EXISTS,
# so re-running is safe and a partially-migrated database converges.
#
# These must be applied BEFORE the new images serve traffic: the menu, sale and
# sale-return queries name `description` explicitly and the invoice-settings
# upsert writes the new columns, so an un-migrated database returns 500s.
set -euo pipefail

ENV="${1:-}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

case "$ENV" in
  uat)
    # UAT postgres is exposed on the host, so psql can reach it directly.
    HOST=72.60.206.59; PORT=5432; USER=zodudb
    export PGPASSWORD='zodu@2025'
    AUTH_DB=retail_auth_service
    RETAIL_DB=retail_restaurant_service
    RESTAURANT_DB=restaurant-service
    PUBLIC_BASE=https://api.myzodu.com
    run_sql() { psql -h "$HOST" -p "$PORT" -U "$USER" -d "$1" -v ON_ERROR_STOP=1 -f "$2"; }
    ;;
  prod)
    # postgres_prod is a docker-network hostname — pipe the file into psql
    # inside the container instead of connecting over the network.
    PGCONTAINER="${PGCONTAINER:-postgres_prod}"; USER=zoduprod
    AUTH_DB=auth_service
    RETAIL_DB=retail_service
    RESTAURANT_DB=restaurant_service
    PUBLIC_BASE=https://api.zodu.in
    run_sql() {
      docker exec -i -e PGPASSWORD='zodu@2025' "$PGCONTAINER" \
        psql -U "$USER" -d "$1" -v ON_ERROR_STOP=1 < "$2"
    }
    ;;
  *)
    echo "usage: $0 {uat|prod}" >&2
    exit 2
    ;;
esac

apply() {  # apply <db> <path-relative-to-repo-root>
  echo
  echo "=== $ENV / $1  <-  $2"
  run_sql "$1" "$ROOT/$2"
}

# auth-service — invoice settings. The base table first so a database that has
# never had this feature converges to the same shape as one that has.
apply "$AUTH_DB" auth-service/migrations/invoice_settings.sql
apply "$AUTH_DB" auth-service/migrations/invoice_settings_printer_default_by_type.sql
apply "$AUTH_DB" auth-service/migrations/invoice_settings_extra_fields.sql
apply "$AUTH_DB" auth-service/migrations/invoice_settings_theme_color.sql
apply "$AUTH_DB" auth-service/migrations/invoice_settings_signature_url.sql
apply "$AUTH_DB" auth-service/migrations/invoice_settings_payment_types.sql
apply "$AUTH_DB" auth-service/migrations/invoice_settings_template.sql
apply "$AUTH_DB" auth-service/migrations/invoice_settings_pos_behaviours.sql
apply "$AUTH_DB" auth-service/migrations/invoice_settings_shipping_address.sql
apply "$AUTH_DB" auth-service/migrations/invoice_settings_copy_types.sql
apply "$AUTH_DB" auth-service/migrations/pos_settings.sql
apply "$AUTH_DB" auth-service/migrations/invoice_settings_serial_no.sql
apply "$AUTH_DB" auth-service/migrations/pos_settings_invoice_suffix.sql
apply "$AUTH_DB" auth-service/migrations/invoice_settings_prefix_enabled.sql
apply "$AUTH_DB" auth-service/migrations/invoice_settings_remove_digit_count.sql
apply "$AUTH_DB" auth-service/migrations/pos_settings_type_prefixes.sql
apply "$AUTH_DB" auth-service/migrations/pos_settings_type_prefix_toggle_suffix.sql

# auth-service — company logo on tbl_business. The create-company INSERT names
# this column, so an un-migrated database fails every company create.
apply "$AUTH_DB" auth-service/migrations/business_company_logo_url.sql

# retail-service / restaurant-service — item description
apply "$RETAIL_DB"     retail-service/migrations/item_description.sql
apply "$RESTAURANT_DB" restaurant-service/migrations/item_description.sql

# retail-service — vehicle number on tbl_sales, printed on the invoice's
# Transport Copy (see auth-service/migrations/invoice_settings_copy_types.sql).
apply "$RETAIL_DB" retail-service/migrations/sales_vehicle_no.sql

# retail-service — customer's purchase order no/date on tbl_sales.
apply "$RETAIL_DB" retail-service/migrations/sales_purchase_order.sql

# retail-service / restaurant-service — sequential purchase/expense/customer
# IDs (tbl_doc_id_seq). customer_id_sequence.sql reuses the counter table
# purchase_expense_id_sequence.sql creates, so that one runs first.
apply "$RETAIL_DB"     retail-service/migrations/purchase_expense_id_sequence.sql
apply "$RESTAURANT_DB" restaurant-service/migrations/purchase_expense_id_sequence.sql

# retail-service — seeds tbl_doc_id_seq's INV/QUO/PRO counters from existing
# tbl_sales rows. Must run before generateSaleId's tbl_doc_id_seq-based
# numbering is live, or the first new sale/quotation/proforma on any branch
# with sales history regenerates an already-used sale_id and 500s on
# tbl_sales' unique_sale_per_branch constraint.
apply "$RETAIL_DB" retail-service/migrations/sales_doc_sequence_backfill.sql

# retail-service — widens tbl_sales' uniqueness to (sale_id, branch_id,
# sale_type) so Quotation/Proforma prefixes matching Invoice's don't collide.
apply "$RETAIL_DB" retail-service/migrations/sales_id_unique_include_type.sql

apply "$RETAIL_DB"     retail-service/migrations/customer_id_sequence.sql
apply "$RESTAURANT_DB" restaurant-service/migrations/customer_id_sequence.sql

# Older rows were written before PUBLIC_FILE_BASE_URL existed, so they carry
# whatever origin the code defaulted to at the time (myzodu.com, zodu.in, ...).
# Repoint every stored file URL at this environment's public origin: swap the
# scheme+host, keep the /auth/file/<key> path. Idempotent — rows already on
# $PUBLIC_BASE are excluded, so re-running changes nothing.
echo
echo "=== $ENV / $AUTH_DB  <-  repoint file URLs to $PUBLIC_BASE"
run_sql "$AUTH_DB" /dev/stdin <<SQL
UPDATE tbl_invoice_settings
   SET signature_url = regexp_replace(signature_url, '^https?://[^/]+', '$PUBLIC_BASE')
 WHERE signature_url ~ '^https?://'
   AND signature_url NOT LIKE '$PUBLIC_BASE/%';

UPDATE tbl_business
   SET company_logo_url = regexp_replace(company_logo_url, '^https?://[^/]+', '$PUBLIC_BASE')
 WHERE company_logo_url ~ '^https?://'
   AND company_logo_url NOT LIKE '$PUBLIC_BASE/%';
SQL

echo
echo "=== verification ==="
run_sql "$AUTH_DB" /dev/stdin <<'SQL'
SELECT 'invoice settings columns present: ' || count(*) || '/20'
FROM information_schema.columns
WHERE table_name = 'tbl_invoice_settings'
  AND column_name IN ('invoice_start_number','invoice_prefix_enabled','show_item_id','show_description',
                      'show_customer_details','show_tax_details','show_payment_details','show_bank_details',
                      'show_signature','show_shipping_address','show_serial_no','show_terms_conditions','terms_conditions','show_notes','notes',
                      'invoice_theme_color','signature_url','payment_types','invoice_copy_types','invoice_template');
SELECT 'invoice_digit_count removed: ' || count(*) || '/0'
FROM information_schema.columns
WHERE table_name = 'tbl_invoice_settings' AND column_name = 'invoice_digit_count';
SELECT 'tbl_business.company_logo_url present: ' || count(*) || '/1'
FROM information_schema.columns
WHERE table_name = 'tbl_business' AND column_name = 'company_logo_url';
SELECT 'tbl_pos_settings columns present: ' || count(*) || '/12'
FROM information_schema.columns
WHERE table_name = 'tbl_pos_settings' AND column_name IN ('pos_types','default_pos_type','invoice_suffix','invoice_suffix_enabled',
                      'quotation_prefix','proforma_prefix','quotation_prefix_enabled','proforma_prefix_enabled',
                      'quotation_suffix','quotation_suffix_enabled','proforma_suffix','proforma_suffix_enabled');
SQL

for db in "$RETAIL_DB" "$RESTAURANT_DB"; do
  run_sql "$db" /dev/stdin <<SQL
SELECT '$db description on: ' || COALESCE(string_agg(table_name, ', ' ORDER BY table_name), '(none)')
FROM information_schema.columns
WHERE column_name = 'description'
  AND table_name IN ('tbl_menu_items','tbl_sale_items','tbl_sale_return_items');
SQL
done

run_sql "$RETAIL_DB" /dev/stdin <<'SQL'
SELECT 'tbl_sales.vehicle_no present: ' || count(*) || '/1'
FROM information_schema.columns
WHERE table_name = 'tbl_sales' AND column_name = 'vehicle_no';
SELECT 'tbl_sales purchase_order columns present: ' || count(*) || '/2'
FROM information_schema.columns
WHERE table_name = 'tbl_sales' AND column_name IN ('purchase_order_no','purchase_order_date');
SELECT 'tbl_sales unique_sale_per_branch_type present: ' || count(*) || '/1'
FROM pg_constraint WHERE conname = 'unique_sale_per_branch_type';
SQL

for db in "$RETAIL_DB" "$RESTAURANT_DB"; do
  run_sql "$db" /dev/stdin <<SQL
SELECT '$db tbl_doc_id_seq present: ' || count(*) || '/1'
FROM information_schema.tables
WHERE table_name = 'tbl_doc_id_seq';
SQL
done

echo
echo "done — $ENV migrated"
