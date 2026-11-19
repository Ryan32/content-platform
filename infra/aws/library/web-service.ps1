<#
Registers the AE Library dev web task definition and creates or updates the aecp-dev-library-web ECS service
behind aecp-dev-library-tg. Tasks run in the private app subnets without public IPs.
Usage: .\infra\aws\library\web-service.ps1 [-Profile ae-dev-mfa]
#>
param(
    [string] $Profile = 'ae-dev-mfa',
    # Linux/amd64 manifest digest of the runtime image in aecp-dev-cms to deploy.
    [Parameter(Mandatory)] [ValidatePattern('^sha256:[0-9a-f]{64}$')] [string] $ImageDigest
)
$ErrorActionPreference = 'Continue'
$env:AWS_PAGER = ''
$aws = @('--profile', $Profile, '--region', 'us-east-1')
$account = '381003255014'
$secret = "arn:aws:secretsmanager:us-east-1:${account}:secret"
$cluster = 'aecp-dev-cms'
$service = 'aecp-dev-library-web'
$image = "$account.dkr.ecr.us-east-1.amazonaws.com/aecp-dev-cms@$ImageDigest"
$webGroup = 'sg-0c6e301657f022b7c'
$subnets = 'subnet-0065c49d9550686c6,subnet-0c59417bf207bca9c'
function Invoke-Aws { $out = & aws @args; if ($LASTEXITCODE) { throw "aws $($args[0]) $($args[1]) failed" }; $out }

# Semantic search: the web app embeds each search query (Titan Text Embeddings V2). Only that model, nothing else.
$embedPolicy = @{ Version = '2012-10-17'; Statement = @(@{ Sid = 'EmbedSearchQueries'; Effect = 'Allow'; Action = 'bedrock:InvokeModel'
    Resource = 'arn:aws:bedrock:us-east-1::foundation-model/amazon.titan-embed-text-v2:0' }) }
$embedFile = Join-Path $env:TEMP 'aecp-web-embed.json'
[IO.File]::WriteAllText($embedFile, ($embedPolicy | ConvertTo-Json -Depth 6))
try { Invoke-Aws iam put-role-policy --profile $Profile --role-name aecp-dev-library-web-task --policy-name DevLibrarySemanticQuery --policy-document "file://$embedFile" | Out-Null }
finally { Remove-Item -LiteralPath $embedFile -ErrorAction SilentlyContinue }

$targetGroup = Invoke-Aws elbv2 describe-target-groups @aws --names aecp-dev-library-tg --query 'TargetGroups[0].TargetGroupArn' --output text
$definition = @{
    family = $service; networkMode = 'awsvpc'; requiresCompatibilities = @('FARGATE'); cpu = '1024'; memory = '2048'
    runtimePlatform = @{ cpuArchitecture = 'X86_64'; operatingSystemFamily = 'LINUX' }
    executionRoleArn = "arn:aws:iam::${account}:role/aecp-dev-library-web-execution"
    # Read-only access to content/ in the dev bucket for protected file delivery.
    taskRoleArn = "arn:aws:iam::${account}:role/aecp-dev-library-web-task"
    containerDefinitions = @(@{
        name = 'library'; image = $image; essential = $true
        entryPoint = @('node', '-e'); command = @([IO.File]::ReadAllText((Join-Path $PSScriptRoot 'web.js')))
        portMappings = @(@{ containerPort = 3000; protocol = 'tcp' })
        environment = @(
            @{ name = 'PGHOST'; value = 'aecp-dev-postgres.cwgidnxxj114.us-east-1.rds.amazonaws.com' },
            @{ name = 'PLATFORM_ORIGIN'; value = 'https://library-dev.advisorsexcel.com' },
            @{ name = 'AUTH0_ISSUER'; value = 'https://auth-dev.advisorsexcel.com/' },
            @{ name = 'AUTH0_AUDIENCE'; value = 'https://library-dev.advisorsexcel.com/mcp' },
            @{ name = 'AUTH0_CLIENT_ID'; value = 'gjl6CvHxdWvPOtsTph3O1tToxDD93CNB' },
            @{ name = 'CONTENT_BUCKET'; value = 'aecp-dev-381003255014-us-east-1' },
            # Hybrid keyword + semantic search; falls back to keyword-only if Bedrock is unavailable.
            @{ name = 'SEMANTIC_SEARCH'; value = 'true' },
            @{ name = 'AWS_REGION'; value = 'us-east-1' },
            # Status display only: the web app never calls paid providers. The worker enforces these.
            @{ name = 'ALLOW_PAID_PROCESSING'; value = 'true' },
            @{ name = 'BEDROCK_MODEL_IDS'; value = 'us.anthropic.claude-haiku-5-5,us.anthropic.claude-sonnet-5-5' },
            # Azure AD (waad) email is asserted by the company directory and may link an email invitation.
            @{ name = 'AUTH0_TRUSTED_EMAIL_CONNECTIONS'; value = 'waad' })
        secrets = @(
            @{ name = 'DB_PASSWORD'; valueFrom = "${secret}:aecp-dev-library-db-runtime-TKkby2" },
            @{ name = 'PAYLOAD_SECRET'; valueFrom = "${secret}:aecp-dev-library-payload-secret-JHvUB0" },
            @{ name = 'AUTH_SESSION_SECRET'; valueFrom = "${secret}:aecp-dev-library-session-secret-QU7lMf" },
            @{ name = 'AUTH0_CLIENT_SECRET'; valueFrom = "${secret}:aecp-dev-library-auth0-client-secret-ni4pYc" })
        healthCheck = @{ command = @('CMD', 'node', '-e', "fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r.status===200?0:1),()=>process.exit(1))"); interval = 20; timeout = 5; retries = 3; startPeriod = 60 }
        logConfiguration = @{ logDriver = 'awslogs'; options = @{ 'awslogs-group' = '/ecs/aecp-dev/library'; 'awslogs-region' = 'us-east-1'; 'awslogs-stream-prefix' = 'web' } }
    })
    tags = @(@{ key = 'Project'; value = 'AEContentPlatform' }, @{ key = 'Environment'; value = 'dev' }, @{ key = 'Owner'; value = 'AE Content Platform' })
}
$file = Join-Path $env:TEMP "$service.json"
[IO.File]::WriteAllText($file, ($definition | ConvertTo-Json -Depth 10))
try { $taskDefinition = Invoke-Aws ecs register-task-definition @aws --cli-input-json "file://$file" --query taskDefinition.taskDefinitionArn --output text }
finally { Remove-Item -LiteralPath $file -ErrorAction SilentlyContinue }
"Registered $taskDefinition"

$status = & aws ecs describe-services @aws --cluster $cluster --services $service --query 'services[0].status' --output text
if ($status -eq 'ACTIVE') {
    Invoke-Aws ecs update-service @aws --cluster $cluster --service $service --task-definition $taskDefinition --query 'service.serviceName' --output text | Out-Null
    "Updated $service"
} else {
    Invoke-Aws ecs create-service @aws --cluster $cluster --service-name $service --task-definition $taskDefinition --desired-count 1 --launch-type FARGATE `
        --network-configuration "awsvpcConfiguration={subnets=[$subnets],securityGroups=[$webGroup],assignPublicIp=DISABLED}" `
        --load-balancers "targetGroupArn=$targetGroup,containerName=library,containerPort=3000" --health-check-grace-period-seconds 90 `
        --deployment-configuration 'minimumHealthyPercent=100,maximumPercent=200,deploymentCircuitBreaker={enable=true,rollback=true}' `
        --propagate-tags SERVICE --tags 'key=Project,value=AEContentPlatform' 'key=Environment,value=dev' 'key=Owner,value=AE Content Platform' `
        --query 'service.serviceName' --output text | Out-Null
    "Created $service"
}
"Waiting for the service to stabilize..."
Invoke-Aws ecs wait services-stable @aws --cluster $cluster --services $service | Out-Null
Invoke-Aws ecs describe-services @aws --cluster $cluster --services $service --query 'services[0].{running:runningCount,desired:desiredCount,rollout:deployments[0].rolloutState,taskDefinition:taskDefinition}' --output json
Invoke-Aws elbv2 describe-target-health @aws --target-group-arn $targetGroup --query 'TargetHealthDescriptions[].{ip:Target.Id,state:TargetHealth.State,reason:TargetHealth.Reason}' --output json
