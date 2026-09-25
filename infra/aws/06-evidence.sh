#!/usr/bin/env bash
# After the demo: print the records that prove scaling happened.
source "$(dirname "$0")/common.sh"

step "Scaling activities (Application Auto Scaling)"
aws application-autoscaling describe-scaling-activities --service-namespace ecs \
  --resource-id "service/${CLUSTER}/${SERVICE}" --max-items 12 \
  --query 'ScalingActivities[].[StartTime,StatusCode,Description]' --output table

step "ECS service events"
aws ecs describe-services --cluster "$CLUSTER" --services "$SERVICE" \
  --query 'services[0].events[:12].[createdAt,message]' --output table

step "Dead-letter queue (should be 0)"
DLQ_URL="$(aws sqs get-queue-url --queue-name "$DLQ_NAME" --query QueueUrl --output text)"
aws sqs get-queue-attributes --queue-url "$DLQ_URL" --attribute-names ApproximateNumberOfMessages \
  --query Attributes.ApproximateNumberOfMessages --output text

step "Decisions in DynamoDB, by the task that made them"
cd "$REPO_ROOT"
AWS_REGION="$AWS_REGION" DISPATCH_TABLE="$DISPATCH_TABLE" npm run --silent summary -w @gridpulse/dispatch-optimizer-service
