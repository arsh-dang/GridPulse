#!/usr/bin/env bash
# Shared settings for the GridPulse AWS scripts. Sourced by every step.
# Written for the AWS Academy Learner Lab: us-east-1, and LabRole in place of
# roles we are not allowed to create.
set -euo pipefail

export AWS_REGION="${AWS_REGION:-us-east-1}"
export AWS_DEFAULT_REGION="$AWS_REGION"
export AWS_PAGER=""

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$HERE/../.." && pwd)"
OUT="$HERE/out.env"          # values later steps need (queue URL, endpoint...)
CERTS="$HERE/certs"          # IoT device certificate and keys, git-ignored

ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text)"
LAB_ROLE_ARN="arn:aws:iam::${ACCOUNT_ID}:role/LabRole"

QUEUE_NAME="gridpulse-events"
DLQ_NAME="gridpulse-events-dlq"
PRICES_TABLE="gridpulse-prices"
DISPATCH_TABLE="gridpulse-dispatch"
IOT_POLICY="gridpulse-device-policy"
IOT_THING="gridpulse-fleet-gateway"
IOT_RULE="gridpulse_events_to_sqs"
ECR_REPO="gridpulse-optimizer"
CLUSTER="gridpulse"
SERVICE="gridpulse-optimizer"
LOG_GROUP="/ecs/gridpulse-optimizer"
MIN_TASKS=1
MAX_TASKS=8

# save KEY VALUE: record a value in out.env for later steps and for the apps.
save() {
  touch "$OUT"
  grep -v "^$1=" "$OUT" > "$OUT.tmp" || true
  mv "$OUT.tmp" "$OUT"
  echo "$1=$2" >> "$OUT"
}

step() { printf '\n\033[1m== %s\033[0m\n' "$*"; }

# shellcheck disable=SC1090
[ -f "$OUT" ] && source "$OUT"
save AWS_REGION "$AWS_REGION"
