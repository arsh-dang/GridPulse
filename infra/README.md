# GridPulse on AWS

Scripts for the AWS Academy Learner Lab (us-east-1). They use the lab's
existing `LabRole` wherever AWS needs a role, since the lab does not allow
creating IAM roles.

```
price-ingest-service --+
                       +-- MQTT/TLS --> IoT Core --rule--> SQS --> ECS Fargate optimiser --> DynamoDB
simulator (fleet) -----+                                   |            (1 to 8 tasks)
                                                           +--> DLQ     ^
                                           CloudWatch alarm on backlog -+
```

## 0. Build box (one EC2 instance)

Everything runs from one EC2 instance, so there are no access keys to copy
around: the instance profile gives the AWS CLI its credentials.

1. EC2 > Launch instance: Amazon Linux 2023, **t3.small**, key pair `vockey`,
   default VPC, allow SSH, and under Advanced details set
   **IAM instance profile = LabInstanceProfile**.
2. SSH in and run:

```bash
sudo dnf install -y docker git tmux
sudo systemctl enable --now docker
sudo usermod -aG docker ec2-user && newgrp docker
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
source ~/.bashrc && nvm install 20
git clone https://github.com/arsh-dang/GridPulse.git && cd GridPulse
npm ci && npm run build
aws sts get-caller-identity   # should show assumed-role/LabRole
```

## 1 to 4. Create the stack

```bash
bash infra/aws/01-data.sh         # SQS queue + DLQ, DynamoDB tables
bash infra/aws/02-iot.sh          # certificate, policy, thing, rule; ends with PASS or FAIL
bash infra/aws/03-deploy.sh       # image to ECR, ECS Fargate service with 1 task
bash infra/aws/04-autoscaling.sh  # step scaling on the SQS backlog, alarms, dashboard
```

Each script prints what it created and saves values to `infra/aws/out.env`.
Re-running a script is safe.

If 02 prints FAIL, IoT Core cannot use LabRole to write to SQS in this lab.
Continue anyway and use `TRANSPORT=sqs` in step 5.

## 5. The scaling demo

Use tmux (`tmux`, then `Ctrl-b %` to split) so both run side by side.

Pane 1, live view:

```bash
bash infra/aws/05-watch.sh
```

Pane 2, the fleet surge (5,000 batteries, 400 messages/s, 15 minutes):

```bash
set -a; source infra/aws/out.env; set +a
BATTERIES=5000 RATE=400 CONNECTIONS=8 DURATION_S=900 npm run surge -w @gridpulse/simulator
```

Expected: WAITING climbs past 100, the scale-out alarm fires within a few
minutes, DESIRED rises and new tasks start, the backlog drains. After the
surge ends, the idle alarm removes one task per minute back down to 1.

If WAITING stays near zero with one task, one task is keeping up: stop the
surge and rerun with `RATE=800 CONNECTIONS=12`.

Open the CloudWatch dashboard `gridpulse` (link printed by 04) and keep it on
a 1-hour range for the screenshots.

## 6. Evidence

```bash
bash infra/aws/06-evidence.sh   # scaling activities, ECS events, DLQ count, decisions by task
```

Screenshots to take: the dashboard (backlog and task count on one timeline),
05-watch output across the run, 06-evidence output, the IoT Core rule and
thing, the ECS service Tasks tab while scaled out, and a few items in the
`gridpulse-dispatch` table.

## Real prices (optional, alongside the demo)

```bash
set -a; source infra/aws/out.env; set +a
export OPENELECTRICITY_API_KEY=... MQTT_CLIENT_ID=gridpulse-price-ingest
npm start -w @gridpulse/price-ingest-service
```

## Clean up

```bash
bash infra/aws/99-teardown.sh
```
Then terminate the build box.

## HD experiments

See [`EXPERIMENTS.md`](EXPERIMENTS.md) for the edge filtering experiments
(`07-metrics.sh`, `08-run-experiment.sh`).
