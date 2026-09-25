#!/usr/bin/env bash
# Live view of the scaling demo, one line every 15 seconds:
# queue backlog, messages in flight, and desired / running / pending tasks.
source "$(dirname "$0")/common.sh"
: "${QUEUE_URL:?run 01-data.sh first}"

printf '%-8s %9s %9s %8s %8s %8s  %s\n' TIME WAITING INFLIGHT DESIRED RUNNING PENDING "LAST SCALING ACTIVITY"
while true; do
  read -r VIS INF <<< "$(aws sqs get-queue-attributes --queue-url "$QUEUE_URL" \
    --attribute-names ApproximateNumberOfMessages ApproximateNumberOfMessagesNotVisible \
    --query 'Attributes.[ApproximateNumberOfMessages,ApproximateNumberOfMessagesNotVisible]' --output text)"
  read -r DES RUN PEN <<< "$(aws ecs describe-services --cluster "$CLUSTER" --services "$SERVICE" \
    --query 'services[0].[desiredCount,runningCount,pendingCount]' --output text)"
  ACT="$(aws application-autoscaling describe-scaling-activities --service-namespace ecs \
    --resource-id "service/${CLUSTER}/${SERVICE}" --max-items 1 \
    --query 'ScalingActivities[0].Description' --output text 2>/dev/null | head -1)"
  printf '%-8s %9s %9s %8s %8s %8s  %s\n' "$(date +%H:%M:%S)" "$VIS" "$INF" "$DES" "$RUN" "$PEN" "$ACT"
  sleep 15
done
