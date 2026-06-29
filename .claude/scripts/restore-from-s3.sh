#!/usr/bin/env bash
#
# Restore the PostgreSQL database from the latest (or a specified) S3 dump.
# Usage:
#   ./restore-from-s3.sh                # restores the most recent dump
#   ./restore-from-s3.sh <s3-key>       # restores a specific dump
#
# WARNING: This overwrites the current database. Confirm before running in prod.

set -euo pipefail

DB_NAME="trading_view_bot"
DB_USER="trading_view_bot"
DB_HOST="127.0.0.1"
DB_PORT="5432"
S3_BUCKET="s3://your-trading-bot-backups"
SECRET_NAME="prod/trading-bot/app"
AWS_REGION="eu-west-2"

# ---- Determine which dump to restore ----
if [ $# -ge 1 ]; then
  S3_KEY="$1"
else
  echo "[restore] Finding the most recent dump..."
  S3_KEY="$(aws s3 ls "${S3_BUCKET}/" --region "${AWS_REGION}" \
    | sort | tail -n 1 | awk '{print $4}')"
  S3_KEY="${S3_BUCKET}/${S3_KEY}"
fi

echo "[restore] Will restore from: ${S3_KEY}"
read -r -p "This OVERWRITES the current database. Type 'yes' to continue: " CONFIRM
if [ "${CONFIRM}" != "yes" ]; then
  echo "[restore] Aborted."
  exit 1
fi

# ---- Fetch DB password ----
DB_PASSWORD="$(aws secretsmanager get-secret-value \
  --region "${AWS_REGION}" \
  --secret-id "${SECRET_NAME}" \
  --query 'SecretString' --output text | python3 -c 'import sys,json; print(json.load(sys.stdin)["DB_PASSWORD"])')"

# ---- Download dump ----
LOCAL_DUMP="/tmp/restore_$(date -u +%s).sql.gz"
echo "[restore] Downloading..."
aws s3 cp "${S3_KEY}" "${LOCAL_DUMP}" --region "${AWS_REGION}"

# ---- Restore ----
echo "[restore] Restoring into ${DB_NAME}..."
gunzip -c "${LOCAL_DUMP}" \
  | PGPASSWORD="${DB_PASSWORD}" psql \
    -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_USER}" "${DB_NAME}"

rm -f "${LOCAL_DUMP}"
unset DB_PASSWORD

echo "[restore] Restore complete. Verify the data, then restart the app (pm2 restart trading_view_bot)."
