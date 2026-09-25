#!/usr/bin/env bash
# Remove everything the GridPulse scripts created, to stop Learner Lab spend.
source "$(dirname "$0")/common.sh"
set +e

step "Autoscaling, alarms, dashboard"
aws cloudwatch delete-alarms --alarm-names gridpulse-backlog-high gridpulse-backlog-idle
aws cloudwatch delete-dashboards --dashboard-names gridpulse >/dev/null
aws application-autoscaling deregister-scalable-target --service-namespace ecs \
  --resource-id "service/${CLUSTER}/${SERVICE}" --scalable-dimension ecs:service:DesiredCount

step "ECS service and cluster"
aws ecs update-service --cluster "$CLUSTER" --service "$SERVICE" --desired-count 0 >/dev/null
aws ecs delete-service --cluster "$CLUSTER" --service "$SERVICE" --force >/dev/null
aws ecs wait services-inactive --cluster "$CLUSTER" --services "$SERVICE"
aws ecs delete-cluster --cluster "$CLUSTER" >/dev/null
aws ecr delete-repository --repository-name "$ECR_REPO" --force >/dev/null

step "IoT Core"
aws iot delete-topic-rule --rule-name "$IOT_RULE"
if [ -n "${CERT_ARN:-}" ]; then
  CERT_ID="${CERT_ARN##*/}"
  aws iot detach-thing-principal --thing-name "$IOT_THING" --principal "$CERT_ARN"
  aws iot detach-policy --policy-name "$IOT_POLICY" --target "$CERT_ARN"
  aws iot update-certificate --certificate-id "$CERT_ID" --new-status INACTIVE
  aws iot delete-certificate --certificate-id "$CERT_ID"
fi
aws iot delete-thing --thing-name "$IOT_THING"
aws iot delete-policy --policy-name "$IOT_POLICY"

step "SQS and DynamoDB"
for q in "$QUEUE_NAME" "$DLQ_NAME"; do
  URL="$(aws sqs get-queue-url --queue-name "$q" --query QueueUrl --output text 2>/dev/null)"
  [ -n "$URL" ] && aws sqs delete-queue --queue-url "$URL"
done
aws dynamodb delete-table --table-name "$PRICES_TABLE" >/dev/null
aws dynamodb delete-table --table-name "$DISPATCH_TABLE" >/dev/null

rm -f "$OUT"
echo "Teardown finished. The EC2 build box is not touched; stop or terminate it in the console."
