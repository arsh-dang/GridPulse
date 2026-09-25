#!/usr/bin/env bash
# Step 3: build the optimiser image, push it to ECR, and run it on ECS Fargate
# as a service with one task. Re-run after code changes to roll out a new image.
source "$(dirname "$0")/common.sh"
: "${QUEUE_URL:?run 01-data.sh first}"

REGISTRY="${ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com"
TAG="$(git -C "$REPO_ROOT" rev-parse --short HEAD 2>/dev/null || date +%s)"
IMAGE="${REGISTRY}/${ECR_REPO}:${TAG}"

step "ECR repository"
aws ecr describe-repositories --repository-names "$ECR_REPO" >/dev/null 2>&1 \
  || aws ecr create-repository --repository-name "$ECR_REPO" --image-scanning-configuration scanOnPush=true >/dev/null
aws ecr get-login-password | docker login --username AWS --password-stdin "$REGISTRY"

step "Build and push $IMAGE"
docker build --platform linux/amd64 -f "$REPO_ROOT/services/dispatch-optimizer-service/Dockerfile" -t "$IMAGE" "$REPO_ROOT"
docker push "$IMAGE"

step "CloudWatch log group"
aws logs create-log-group --log-group-name "$LOG_GROUP" 2>/dev/null || true
aws logs put-retention-policy --log-group-name "$LOG_GROUP" --retention-in-days 7

step "ECS cluster (Container Insights on, for task count metrics)"
aws ecs create-cluster --cluster-name "$CLUSTER" \
  --settings name=containerInsights,value=enabled >/dev/null
echo "$CLUSTER"

step "Task definition (0.25 vCPU, 0.5 GB, LabRole for both roles)"
cat > /tmp/gridpulse-taskdef.json << JSON
{
  "family": "$SERVICE",
  "networkMode": "awsvpc",
  "requiresCompatibilities": ["FARGATE"],
  "cpu": "256",
  "memory": "512",
  "runtimePlatform": { "operatingSystemFamily": "LINUX", "cpuArchitecture": "X86_64" },
  "executionRoleArn": "$LAB_ROLE_ARN",
  "taskRoleArn": "$LAB_ROLE_ARN",
  "containerDefinitions": [{
    "name": "optimizer",
    "image": "$IMAGE",
    "essential": true,
    "stopTimeout": 30,
    "environment": [
      { "name": "AWS_REGION", "value": "$AWS_REGION" },
      { "name": "QUEUE_URL", "value": "$QUEUE_URL" },
      { "name": "PRICES_TABLE", "value": "$PRICES_TABLE" },
      { "name": "DISPATCH_TABLE", "value": "$DISPATCH_TABLE" },
      { "name": "SPIKE_THRESHOLD", "value": "300" },
      { "name": "POLLERS", "value": "2" }
    ],
    "logConfiguration": {
      "logDriver": "awslogs",
      "options": {
        "awslogs-group": "$LOG_GROUP",
        "awslogs-region": "$AWS_REGION",
        "awslogs-stream-prefix": "optimizer"
      }
    }
  }]
}
JSON
TASK_DEF_ARN="$(aws ecs register-task-definition --cli-input-json file:///tmp/gridpulse-taskdef.json \
  --query taskDefinition.taskDefinitionArn --output text)"
echo "$TASK_DEF_ARN"

step "Networking: default VPC, three availability zones, no inbound access"
VPC_ID="$(aws ec2 describe-vpcs --filters Name=isDefault,Values=true --query 'Vpcs[0].VpcId' --output text)"
SUBNETS="$(aws ec2 describe-subnets \
  --filters "Name=vpc-id,Values=$VPC_ID" "Name=availability-zone,Values=${AWS_REGION}a,${AWS_REGION}b,${AWS_REGION}c" \
  --query 'Subnets[].SubnetId' --output text | tr '\t' ',')"
SG_ID="$(aws ec2 describe-security-groups --filters "Name=vpc-id,Values=$VPC_ID" "Name=group-name,Values=gridpulse-optimizer-sg" \
  --query 'SecurityGroups[0].GroupId' --output text)"
if [ "$SG_ID" = "None" ]; then
  # Outbound only: the optimiser pulls from SQS and writes to DynamoDB, nothing connects to it.
  SG_ID="$(aws ec2 create-security-group --group-name gridpulse-optimizer-sg \
    --description "GridPulse optimiser: outbound only" --vpc-id "$VPC_ID" --query GroupId --output text)"
fi
echo "VPC $VPC_ID, subnets $SUBNETS, security group $SG_ID"
save SUBNETS "$SUBNETS"
save SG_ID "$SG_ID"

step "ECS service"
STATUS="$(aws ecs describe-services --cluster "$CLUSTER" --services "$SERVICE" --query 'services[0].status' --output text 2>/dev/null || echo NONE)"
if [ "$STATUS" = "ACTIVE" ]; then
  aws ecs update-service --cluster "$CLUSTER" --service "$SERVICE" --task-definition "$TASK_DEF_ARN" \
    --force-new-deployment >/dev/null
  echo "Service updated to $TASK_DEF_ARN"
else
  aws ecs create-service --cluster "$CLUSTER" --service-name "$SERVICE" --task-definition "$TASK_DEF_ARN" \
    --desired-count "$MIN_TASKS" --launch-type FARGATE \
    --network-configuration "awsvpcConfiguration={subnets=[$SUBNETS],securityGroups=[$SG_ID],assignPublicIp=ENABLED}" \
    >/dev/null
  echo "Service created"
fi

step "Waiting for the service to become stable (a few minutes)"
aws ecs wait services-stable --cluster "$CLUSTER" --services "$SERVICE"
aws ecs describe-services --cluster "$CLUSTER" --services "$SERVICE" \
  --query 'services[0].{desired:desiredCount,running:runningCount,taskDefinition:taskDefinition}' --output table

step "Done. Next: bash infra/aws/04-autoscaling.sh"
