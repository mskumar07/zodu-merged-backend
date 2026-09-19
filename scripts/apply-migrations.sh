#!/usr/bin/env bash
#
# Applies every invoice-settings / item-description migration to one environment.
#
#   ./scripts/apply-migrations.sh local   # localhost:5432, run from the repo root
#   ./scripts/apply-migrations.sh uat     # runs from anywhere: UAT DB is on a reachable host
#   ./scripts/apply-migrations.sh prod    # RUN ON THE PROD HOST: postgres_prod is docker-internal
#
# checklist-service / employee-service / payroll-service / api-gateway have no
# migrations/*.sql yet — CHECKLIST_DB/EMPLOYEE_DB/PAYROLL_DB are wired up in
# every env case below so adding their first migration only needs one new
# `apply "$X_DB" x-service/migrations/foo.sql` line, no connection-plumbing.
#
# Every file is ADD COLUMN IF NOT EXISTS / CREATE OR REPLACE / DROP ... IF EXISTS,
# so re-running is safe and a partially-migrated database converges.
#
# Each apply() call is tracked in a per-database tbl_schema_migrations table
# (created automatically on first use). A file already recorded there is
# SKIPPED on subsequent runs — only newly added `apply` lines actually
# execute. This means re-running this script after everything is up to date
# is fast and touches nothing, and a fresh new migration file you add is the
# only thing that runs next time. The file-URL repoint and verification
# blocks near the bottom are plain idempotent UPDATE/SELECT statements, not
# schema migrations — they intentionally run every time, untracked.
#
# These must be applied BEFORE the new images serve traffic: the menu, sale and
# sale-return queries name `description` explicitly and the invoice-settings
# upsert writes the new columns, so an un-migrated database returns 500s.
set -euo pipefail

ENV="${1:-}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

case "$ENV" in
  local)
    # Local Postgres on this machine, same host/db names used manually via
    # psql during development. checklist-service/employee-service/
    # payroll-service/api-gateway have no migrations/*.sql yet — their DB
    # vars are wired up here so future migrations only need an `apply` line.
    # Override with LOCAL_DB_HOST=host.docker.internal when there's no native
    # psql client and this runs inside a `docker run ... postgres:16-alpine
    # bash scripts/apply-migrations.sh local` container instead (localhost
    # there means the container itself, not this machine).
    HOST="${LOCAL_DB_HOST:-localhost}"; PORT=5433; USER=postgres
    export PGPASSWORD='postgres'   # uncomment to skip the interactive prompt
    AUTH_DB=retail_auth_service
    RETAIL_DB=retail_service
    RESTAURANT_DB=restaurant_service
    CHECKLIST_DB=checklist-service
    EMPLOYEE_DB=retail_employee_service
    PAYROLL_DB=payroll-service
    # api-gateway (not the frontend on 5173) — it proxies /auth/* to
    # auth-service, so /auth/file/<key> is reachable through here, matching
    # how uat/prod point at their public gateway origins below.
    PUBLIC_BASE=http://localhost:5001
    run_sql() { psql -h "$HOST" -p "$PORT" -U "$USER" -d "$1" -v ON_ERROR_STOP=1 -f "$2"; }
    run_sql_str() { psql -h "$HOST" -p "$PORT" -U "$USER" -d "$1" -v ON_ERROR_STOP=1 -tAc "$2"; }
    run_sql_stdin() { psql -h "$HOST" -p "$PORT" -U "$USER" -d "$1" -v ON_ERROR_STOP=1; }
    ;;
  uat)
    # UAT postgres is exposed on the host, so psql can reach it directly.
    HOST=72.60.206.59; PORT=5432; USER=zodudb
    export PGPASSWORD='zodu@2025'
    AUTH_DB=retail_auth_service
    RETAIL_DB=retail_restaurant_service
    RESTAURANT_DB=restaurant-service
    CHECKLIST_DB=checklist-service
    EMPLOYEE_DB=employee-service
    PAYROLL_DB=payroll-service
    PUBLIC_BASE=https://api.myzodu.com
    run_sql() { psql -h "$HOST" -p "$PORT" -U "$USER" -d "$1" -v ON_ERROR_STOP=1 -f "$2"; }
    run_sql_str() { psql -h "$HOST" -p "$PORT" -U "$USER" -d "$1" -v ON_ERROR_STOP=1 -tAc "$2"; }
    run_sql_stdin() { psql -h "$HOST" -p "$PORT" -U "$USER" -d "$1" -v ON_ERROR_STOP=1; }
    ;;
  prod)
    # postgres_prod's port (5433, per docker-compose.prod.yml) is reachable
    # directly on the host, same as UAT's 5432 — no docker exec/SSH needed.
    HOST=72.60.206.59; PORT=5433; USER=zoduprod
    export PGPASSWORD='zodu@2025'
    AUTH_DB=auth_service
    RETAIL_DB=retail_service
    RESTAURANT_DB=restaurant_service
    CHECKLIST_DB=checklist-service
    EMPLOYEE_DB=employee_service
    PAYROLL_DB=payroll-service
    PUBLIC_BASE=https://api.zodu.in
    run_sql() { psql -h "$HOST" -p "$PORT" -U "$USER" -d "$1" -v ON_ERROR_STOP=1 -f "$2"; }
    run_sql_str() { psql -h "$HOST" -p "$PORT" -U "$USER" -d "$1" -v ON_ERROR_STOP=1 -tAc "$2"; }
    run_sql_stdin() { psql -h "$HOST" -p "$PORT" -U "$USER" -d "$1" -v ON_ERROR_STOP=1; }
    ;;
  *)
    echo "usage: $0 {local|uat|prod}" >&2
    exit 2
    ;;
esac

ensure_tracking_table() {  # ensure_tracking_table <db>
  run_sql_str "$1" "
    CREATE TABLE IF NOT EXISTS tbl_schema_migrations (
        migration_file VARCHAR(255) PRIMARY KEY,
        applied_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  " > /dev/null
}

already_applied() {  # already_applied <db> <path> -> exit 0 if applied
  local result
  result="$(run_sql_str "$1" "SELECT 1 FROM tbl_schema_migrations WHERE migration_file = '$2';")"
  [ "$result" = "1" ]
}

record_applied() {  # record_applied <db> <path>
  run_sql_str "$1" "
    INSERT INTO tbl_schema_migrations (migration_file) VALUES ('$2')
    ON CONFLICT (migration_file) DO UPDATE SET applied_at = CURRENT_TIMESTAMP;
  " > /dev/null
}

apply() {  # apply <db> <path-relative-to-repo-root>
  ensure_tracking_table "$1"

  if already_applied "$1" "$2"; then
    echo
    echo "=== $ENV / $1  <-  $2  (already applied, skipping)"
    return
  fi

  echo
  echo "=== $ENV / $1  <-  $2"
  run_sql "$1" "$ROOT/$2"
  record_applied "$1" "$2"
}

# force_apply <db> <path> — like apply(), but always runs the file even if
# tbl_schema_migrations already has a row for it. Every migration file here
# is CREATE OR REPLACE / DROP...IF EXISTS / ADD COLUMN IF NOT EXISTS, so
# re-running is safe. Use this ONLY for a file whose CONTENT changed after it
# was already recorded as applied on an environment — normal new migrations
# should use apply(), not this. Re-records the same path, so a later normal
# apply() call for it still correctly skips.
force_apply() {  # force_apply <db> <path-relative-to-repo-root>
  ensure_tracking_table "$1"
  echo
  echo "=== $ENV / $1  <-  $2  (forced re-apply — content changed since it was first recorded)"
  run_sql "$1" "$ROOT/$2"
  record_applied "$1" "$2"
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
apply "$AUTH_DB" auth-service/migrations/pos_settings_purchase_order_enabled.sql
apply "$AUTH_DB" auth-service/migrations/pos_settings_hold_enabled.sql
apply "$AUTH_DB" auth-service/migrations/pos_settings_screen_type.sql
apply "$AUTH_DB" auth-service/migrations/invoice_prefix_enabled_default_true.sql
apply "$AUTH_DB" auth-service/migrations/pos_settings_kot_print.sql


# auth-service — company logo on tbl_business. The create-company INSERT names
# this column, so an un-migrated database fails every company create.
apply "$AUTH_DB" auth-service/migrations/business_company_logo_url.sql

# retail-service / restaurant-service — item description
apply "$RETAIL_DB"     retail-service/migrations/item_description.sql
apply "$RESTAURANT_DB" restaurant-service/migrations/item_description.sql

# restaurant-service — KOT counters, printers, per-counter tickets and print log.
# The order endpoints write tickets after every send, so this must land first.
apply "$RESTAURANT_DB" restaurant-service/migrations/kot_counters_printers.sql
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

# tbl_purchase.purchase_id / tbl_expense.expense_id were globally unique
# (tbl_expense.expense_id was literally the PK) instead of scoped per
# zodu_id, causing spurious duplicate-key errors the moment two tenants
# shared a branch code. Must run before any new purchase/expense insert
# collides — see the migration file for full detail on the PK swap.
apply "$RETAIL_DB"     retail-service/migrations/purchase_expense_id_tenant_scoped_unique.sql
apply "$RESTAURANT_DB" restaurant-service/migrations/purchase_expense_id_tenant_scoped_unique.sql

# fn_purge_branch(zodu_id, branch_id) per database — hard-deletes every row
# scoped to one branch, called by auth-service's delete-branch orchestrator
# (auth-service/src/services/auth-service.js DeleteBranch). Independent per
# database, no ordering dependency between them.
#
# auth-service/migrations/branch_purge_function.sql was revised on
# 2026-09-17 (removed a tbl_users/tbl_user_sessions delete that violated
# tbl_user_companies_user_id_fkey whenever the user still had access to any
# other company — users are a company-level concept, only fn_purge_company
# should ever delete tbl_users), AFTER already being recorded as applied on
# some environments — force_apply so it actually re-runs there instead of
# `apply` silently skipping it and leaving the broken function in place.
apply "$AUTH_DB" auth-service/migrations/branch_purge_function.sql
apply "$RETAIL_DB"     retail-service/migrations/branch_purge_function.sql
apply "$RESTAURANT_DB" restaurant-service/migrations/branch_purge_function.sql
apply "$EMPLOYEE_DB"   employee-service/migrations/branch_purge_function.sql
apply "$PAYROLL_DB"    payroll-service/migrations/branch_purge_function.sql
apply "$CHECKLIST_DB"  checklist-service/migrations/branch_purge_function.sql

# fn_purge_company(zodu_id) per database — hard-deletes every row scoped to
# an entire company across ALL its branches at once, called by auth-service's
# delete-company orchestrator (auth-service/src/services/auth-service.js
# DeleteCompany). Superset of fn_purge_branch; independent per database.
apply "$AUTH_DB"       auth-service/migrations/company_purge_function.sql
apply "$RETAIL_DB"     retail-service/migrations/company_purge_function.sql
apply "$RESTAURANT_DB" restaurant-service/migrations/company_purge_function.sql
apply "$EMPLOYEE_DB"   employee-service/migrations/company_purge_function.sql
apply "$PAYROLL_DB"    payroll-service/migrations/company_purge_function.sql
apply "$CHECKLIST_DB"  checklist-service/migrations/company_purge_function.sql

# employee-service — tbl_employees was unique on (user_id, zodu_id) and
# (employee_code, zodu_id), i.e. one employee row per user per company and
# company-wide employee-code numbering. Both widened to include branch_id so
# AddBranch can seed a separate Admin employee row per branch (auth-service's
# AddBranch, POST /api/branch/add) and every branch's first employee starts
# at EMP001 instead of continuing the company's running number.
apply "$EMPLOYEE_DB" employee-service/migrations/employee_unique_per_branch.sql
apply "$EMPLOYEE_DB" employee-service/migrations/employee_code_unique_per_branch.sql

# restaurant-service — seeds tbl_doc_id_seq's 'ORD' counter from existing
# tbl_orders rows. Must run before generatePublicOrderNo's tbl_doc_id_seq-
# based numbering is live, or the first new order on any branch with order
# history restarts at 001 and collides with tbl_orders'
# uq_orders_branch_public_no constraint.
apply "$RESTAURANT_DB" restaurant-service/migrations/orders_doc_sequence_backfill.sql

# restaurant-service — kot_counter.sql (an earlier, one-day pass at KOT
# counters, tbl_kot_counter singular) is superseded by kot_counters_printers.sql
# above (tbl_kot_counters plural) and is deliberately NOT applied here any
# more — see kot_counter_id_fk_fix.sql and kot_counter_drop_legacy.sql below,
# which clean up the one environment (local, historically) that ran it before
# the mistake was caught.
apply "$RESTAURANT_DB" restaurant-service/migrations/kot_counter_id_fk_fix.sql
# Drops the dead tbl_kot_counter (singular) table/trigger/function on any
# database that had already run kot_counter.sql; a no-op everywhere else.
apply "$RESTAURANT_DB" restaurant-service/migrations/kot_counter_drop_legacy.sql

# restaurant-service — fn_next_kot_no scopes KOT ticket numbers to one order
# (resets to 1 per order) instead of running for the whole branch/day, plus
# a trigger that purges an order's KOT tickets once it's finalized.
apply "$RESTAURANT_DB" restaurant-service/migrations/kot_ticket_no_per_order.sql
# restaurant-service — seeds default tbl_kot_settings rows for every branch
# that already has a menu or an order, matching kot-repo.js's DEFAULT_SETTINGS.
apply "$RESTAURANT_DB" restaurant-service/migrations/kot_settings_backfill_defaults.sql

# restaurant-service — kot_order_status on tbl_orders, tracks the kitchen
# order status on the finalized order.
apply "$RESTAURANT_DB" restaurant-service/migrations/orders_kot_order_status.sql

# restaurant-service — tbl_kot_list.table_no allows NULL, since non-Dine-In
# orders (Takeaway/Delivery) have no table and createKOT inserts NULL for them.
apply "$RESTAURANT_DB" restaurant-service/migrations/kot_list_table_no_nullable_1809202607.sql

# restaurant-service — drops tbl_kot_list's FK to tbl_tmp_orders. createKOT
# now also runs for Takeaway/Delivery orders, which never get a tbl_tmp_orders
# row (they write straight to tbl_orders), so the FK 500s on every such insert.

# Older rows were written before PUBLIC_FILE_BASE_URL existed, so they carry
# whatever origin the code defaulted to at the time (myzodu.com, zodu.in, ...).
# Repoint every stored file URL at this environment's public origin: swap the
# scheme+host, keep the /auth/file/<key> path. Idempotent — rows already on
# $PUBLIC_BASE are excluded, so re-running changes nothing.
echo
echo "=== $ENV / $AUTH_DB  <-  repoint file URLs to $PUBLIC_BASE"
run_sql_stdin "$AUTH_DB" <<SQL
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
run_sql_stdin "$AUTH_DB" <<'SQL'
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
SELECT 'tbl_pos_settings columns present: ' || count(*) || '/16'
FROM information_schema.columns
WHERE table_name = 'tbl_pos_settings' AND column_name IN ('pos_types','default_pos_type','invoice_suffix','invoice_suffix_enabled',
                      'quotation_prefix','proforma_prefix','quotation_prefix_enabled','proforma_prefix_enabled',
                      'quotation_suffix','quotation_suffix_enabled','proforma_suffix','proforma_suffix_enabled',
                      'purchase_order_enabled','hold_enabled','pos_screen_type','kot_print_enabled');
SQL

for db in "$RETAIL_DB" "$RESTAURANT_DB"; do
  run_sql_stdin "$db" <<SQL
SELECT '$db description on: ' || COALESCE(string_agg(table_name, ', ' ORDER BY table_name), '(none)')
FROM information_schema.columns
WHERE column_name = 'description'
  AND table_name IN ('tbl_menu_items','tbl_sale_items','tbl_sale_return_items');
SQL
done

run_sql_stdin "$RETAIL_DB" <<'SQL'
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
  run_sql_stdin "$db" <<SQL
SELECT '$db tbl_doc_id_seq present: ' || count(*) || '/1'
FROM information_schema.tables
WHERE table_name = 'tbl_doc_id_seq';
SQL
done

echo
echo "done — $ENV migrated"
