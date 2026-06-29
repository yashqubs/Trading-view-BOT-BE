#!/usr/bin/env bash
#
# Nightly PostgreSQL backup to encrypted S3 bucket.
# Run via cron at 02:00 UTC:  0 2 * * *  /path/to/backup-to-s3.sh
#
# Requires: pg_dump, aws cli, IAM role on the EC2 instance with s3:PutObject
# on the backup bucket. Secrets (DB password) are read from AWS Secrets Manager,
# never hardcoded here.

set -euo pipefail

# ---- Config (non-sensitive) ----
DB_NAME="trading_view_bot"
DB_USER="trading_view_bot"
DB_HOST="127.0.0.1"
DB_PORT="5432"
S3_BUCKET="s3://your-trading-bot-backups"
SECRET_NAME="prod/trading-bot/app"
AWS_REGION="eu-west-2"
RETENTION_DAYS=30

# ---- Derived ----
TIMESTAMP="$(date -u +%Y-%m-%dT%H-%M-%SZ)"
DUMP_FILE="/tmp/${DB_NAME}_${TIMESTAMP}.sql.gz"
S3_KEY="${S3_BUCKET}/${DB_NAME}_${TIMESTAMP}.sql.gz"

echo "[backup] Starting backup at ${TIMESTAMP}"

# ---- Fetch DB password from Secrets Manager (never stored on disk) ----
DB_PASSWORD="$(aws secretsmanager get-secret-value \
  --region "${AWS_REGION}" \
  --secret-id "${SECRET_NAME}" \
  --query 'SecretString' --output text | python3 -c 'import sys,json; print(json.load(sys.stdin)["DB_PASSWORD"])')"

# ---- Dump + compress ----
echo "[backup] Dumping database..."
PGPASSWORD="${DB_PASSWORD}" pg_dump \
  -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_USER}" "${DB_NAME}" \
  | gzip > "${DUMP_FILE}"

DUMP_SIZE="$(du -h "${DUMP_FILE}" | cut -f1)"
echo "[backup] Dump created: ${DUMP_FILE} (${DUMP_SIZE})"

# ---- Upload to encrypted S3 (bucket has SSE-S3 enabled) ----
echo "[backup] Uploading to ${S3_KEY}..."
aws s3 cp "${DUMP_FILE}" "${S3_KEY}" \
  --region "${AWS_REGION}" \
  --sse AES256

echo "[backup] Upload complete."

# ---- Clean up local temp file ----
rm -f "${DUMP_FILE}"
unset DB_PASSWORD

# ---- Note: old dumps are deleted automatically by the S3 lifecycle rule ----
# (configured to expire objects after ${RETENTION_DAYS} days)

echo "[backup] Done at $(date -u +%Y-%m-%dT%H-%M-%SZ)"
