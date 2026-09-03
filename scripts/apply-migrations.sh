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

# auth-service — company logo on tbl_business. The create-company INSERT names
# this column, so an un-migrated database fails every company create.
apply "$AUTH_DB" auth-service/migrations/business_company_logo_url.sql

# retail-service / restaurant-service — item description
apply "$RETAIL_DB"     retail-service/migrations/item_description.sql
apply "$RESTAURANT_DB" restaurant-service/migrations/item_description.sql

# Rows written while PUBLIC_FILE_BASE_URL was unset carry the code default
# (https://myzodu.com), which does not resolve; rows restored from another
# environment carry that environment's origin. Swap whatever origin sits in
# front of /auth/file/ for this environment's, leaving the object key alone.
# Idempotent: rows already on $PUBLIC_BASE are excluded.
echo
echo "=== $ENV / $AUTH_DB  <-  repoint file URLs to $PUBLIC_BASE"
run_sql "$AUTH_DB" /dev/stdin <<SQL
UPDATE tbl_invoice_settings
   SET signature_url = '$PUBLIC_BASE' || substring(signature_url from position('/auth/file/' in signature_url))
 WHERE signature_url LIKE 'http%://%/auth/file/%'
   AND signature_url NOT LIKE '$PUBLIC_BASE/%';

UPDATE tbl_business
   SET company_logo_url = '$PUBLIC_BASE' || substring(company_logo_url from position('/auth/file/' in company_logo_url))
 WHERE company_logo_url LIKE 'http%://%/auth/file/%'
   AND company_logo_url NOT LIKE '$PUBLIC_BASE/%';
SQL

echo
echo "=== verification ==="
run_sql "$AUTH_DB" /dev/stdin <<'SQL'
SELECT 'invoice settings columns present: ' || count(*) || '/17'
FROM information_schema.columns
WHERE table_name = 'tbl_invoice_settings'
  AND column_name IN ('invoice_digit_count','invoice_start_number','show_item_id','show_description',
                      'show_customer_details','show_tax_details','show_payment_details','show_bank_details',
                      'show_signature','show_terms_conditions','terms_conditions','show_notes','notes',
                      'invoice_theme_color','signature_url','payment_types','invoice_template');
SELECT 'tbl_business.company_logo_url present: ' || count(*) || '/1'
FROM information_schema.columns
WHERE table_name = 'tbl_business' AND column_name = 'company_logo_url';
SQL

for db in "$RETAIL_DB" "$RESTAURANT_DB"; do
  run_sql "$db" /dev/stdin <<SQL
SELECT '$db description on: ' || COALESCE(string_agg(table_name, ', ' ORDER BY table_name), '(none)')
FROM information_schema.columns
WHERE column_name = 'description'
  AND table_name IN ('tbl_menu_items','tbl_sale_items','tbl_sale_return_items');
SQL
done

echo
echo "done — $ENV migrated"
