#!/usr/bin/env bash
# Generates the service-to-service tokens and the Redis password for one
# environment and writes them into the host env files that docker compose reads.
#
#   scripts/gen-secrets.sh uat|prod
#
# Master values live in env/secrets.<env>.env (created on first run, chmod 600).
# Each service's env/<service>.<env>.env then gets exactly what it needs:
#   INTERNAL_TOKEN              its own token, sent on its calls to /internal routes
#   INTERNAL_TOKEN_<CALLER>     the token of every service allowed to call it
#   REDIS_URL / REDIS_PASSWORD  where Redis is used
#   JWT_PRIVATE_KEY / JWT_KID   auth-service only: the ES256 key access tokens are
#                               signed with (the other services fetch the public
#                               half from auth-service's JWKS)
# Other lines in those files (DB credentials, APP_SECRET, ...) are kept.
#
# Re-running is safe: existing values are reused. To rotate one token, delete
# its line from env/secrets.<env>.env, re-run, and restart the services.
# Rotating the signing key needs a grace period: docs/security/auth.md.
set -euo pipefail

ENV_NAME="${1:-}"
[[ "$ENV_NAME" == uat || "$ENV_NAME" == prod ]] || { echo "usage: $0 uat|prod" >&2; exit 1; }
command -v openssl >/dev/null || { echo "openssl is required" >&2; exit 1; }

cd "$(dirname "$0")/.."
umask 077
mkdir -p env
MASTER="env/secrets.${ENV_NAME}.env"
touch "$MASTER"

# Services that call other services' /internal routes, each with its own token.
CALLERS=(auth employee restaurant retail checklist admin file payroll)

# Who accepts calls from whom (mirrors the requireInternal(...) lists in the code).
declare -A ACCEPTS=(
  [auth-service]="restaurant retail admin employee file checklist payroll"
  [employee-service]="auth checklist"
  [restaurant-service]="auth"
  [retail-service]="auth admin"
  [payroll-service]="employee auth"
  [checklist-service]="auth"
  [file-service]="auth employee checklist retail restaurant"
  [face-service]="employee"
  [admin-service]=""
  [api-gateway]=""
)
# The token each service sends (empty: it calls no /internal route).
declare -A SENDS=(
  [auth-service]=auth [employee-service]=employee [restaurant-service]=restaurant
  [retail-service]=retail [checklist-service]=checklist [admin-service]=admin
  [file-service]=file [payroll-service]=payroll [face-service]="" [api-gateway]=""
)
USES_REDIS=(api-gateway auth-service file-service)

get() { grep -E "^$1=" "$MASTER" | tail -1 | cut -d= -f2- || true; }
ensure() {
  local name="$1"
  if [[ -z "$(get "$name")" ]]; then
    echo "$name=$(openssl rand -hex 32)" >> "$MASTER"
    echo "generated $name"
  fi
}

for c in "${CALLERS[@]}"; do ensure "INTERNAL_TOKEN_${c^^}"; done
ensure REDIS_PASSWORD

# ES256 (P-256) signing key, PKCS#8 PEM stored base64 on one line.
if [[ -z "$(get JWT_PRIVATE_KEY)" ]]; then
  echo "JWT_PRIVATE_KEY=$(openssl genpkey -algorithm EC -pkeyopt ec_paramgen_curve:P-256 2>/dev/null | openssl base64 -A)" >> "$MASTER"
  echo "JWT_KID=${ENV_NAME}-$(date +%Y%m%d)" >> "$MASTER"
  echo "generated JWT_PRIVATE_KEY (kid $(get JWT_KID))"
fi

# Replace this script's keys in a service env file, keep everything else.
write_service() {
  local svc="$1"; shift
  local file="env/${svc}.${ENV_NAME}.env"
  touch "$file"
  local keep
  keep="$(grep -vE '^(INTERNAL_TOKEN(_[A-Z]+)?|REDIS_URL|REDIS_PASSWORD|JWT_PRIVATE_KEY|JWT_KID)=' "$file" || true)"
  {
    [[ -n "$keep" ]] && printf '%s\n' "$keep"
    printf '%s\n' "$@"
  } > "$file.tmp"
  mv "$file.tmp" "$file"
  chmod 600 "$file"
  echo "wrote $file"
}

for svc in "${!ACCEPTS[@]}"; do
  lines=()
  if [[ -n "${SENDS[$svc]}" ]]; then
    lines+=("INTERNAL_TOKEN=$(get "INTERNAL_TOKEN_${SENDS[$svc]^^}")")
  fi
  for c in ${ACCEPTS[$svc]}; do
    lines+=("INTERNAL_TOKEN_${c^^}=$(get "INTERNAL_TOKEN_${c^^}")")
  done
  for r in "${USES_REDIS[@]}"; do
    [[ "$r" == "$svc" ]] && lines+=("REDIS_URL=redis://:$(get REDIS_PASSWORD)@redis:6379")
  done
  if [[ "$svc" == auth-service ]]; then
    lines+=("JWT_PRIVATE_KEY=$(get JWT_PRIVATE_KEY)" "JWT_KID=$(get JWT_KID)")
  fi
  write_service "$svc" "${lines[@]}"
done
write_service redis "REDIS_PASSWORD=$(get REDIS_PASSWORD)"

echo
echo "Done. Still to fill in by hand (see each service's .env.example):"
echo "  DB_USERNAME / DB_PASSWORD, auth-service APP_SECRET (only to accept the old"
echo "  refresh tokens until LEGACY_REFRESH_CUTOFF), admin-service APP_SECRET (its own),"
echo "  api-gateway CORS_ORIGINS, file-service MinIO keys."
