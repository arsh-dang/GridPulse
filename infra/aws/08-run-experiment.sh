#!/usr/bin/env bash
# Runs one scaling experiment end to end and records it:
#   1. note the start time
#   2. run the fleet surge with the settings in the environment, logging it
#   3. wait until the service is back to 1 task with an empty queue
#   4. collect the CloudWatch metrics for the whole window (07-metrics.sh)
#
#   EDGE_MODE=sod-aware BATTERIES=5000 SAMPLE_RATE=800 bash infra/aws/08-run-experiment.sh E2-edge-5k
source "$(dirname "$0")/common.sh"
LABEL="${1:?experiment label, e.g. E1-periodic-5k}"
mkdir -p "$HERE/results"
cd "$REPO_ROOT"

START="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "$LABEL started $START" | tee "$HERE/results/$LABEL-window.txt"

set -a; source "$OUT"; set +a
npm run --silent surge -w @gridpulse/simulator 2>&1 | tee "$HERE/results/$LABEL-surge.log"

step "Surge finished. Waiting for the service to scale back to 1 task with an empty queue"
calm=0
for _ in $(seq 1 60); do
  read -r VIS INF <<< "$(aws sqs get-queue-attributes --queue-url "$QUEUE_URL" \
    --attribute-names ApproximateNumberOfMessages ApproximateNumberOfMessagesNotVisible \
    --query 'Attributes.[ApproximateNumberOfMessages,ApproximateNumberOfMessagesNotVisible]' --output text)"
  read -r DES RUN <<< "$(aws ecs describe-services --cluster "$CLUSTER" --services "$SERVICE" \
    --query 'services[0].[desiredCount,runningCount]' --output text)"
  echo "$(date -u +%H:%M:%S)  waiting=$VIS inflight=$INF desired=$DES running=$RUN"
  if [ "$VIS" = 0 ] && [ "$INF" = 0 ] && [ "$DES" = 1 ] && [ "$RUN" = 1 ]; then calm=$((calm + 1)); else calm=0; fi
  [ "$calm" -ge 3 ] && break
  sleep 30
done

END="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "$LABEL ended $END" | tee -a "$HERE/results/$LABEL-window.txt"
step "Waiting 3 minutes for CloudWatch to publish the last datapoints"
sleep 180
bash "$HERE/07-metrics.sh" "$START" "$END" "$LABEL" | tee "$HERE/results/$LABEL-summary.txt"
