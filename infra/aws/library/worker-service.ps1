<#
Creates or updates the AE Library dev background worker: secret-scoped execution role, task role for S3 processing,
Amazon Transcribe and approved Bedrock models, task definition, and the always-on ECS service (no load balancer).
Usage: .\infra\aws\library\worker-service.ps1 -ImageDigest sha256:<operations amd64 manifest> [-Profile ae-dev-mfa]
The Vimeo token secret must already hold a value (see docs/STATUS.md); it is never printed.
#>
param(
    [Parameter(Mandatory)] [ValidatePattern('^sha256:[0-9a-f]{64}$')] [string] $ImageDigest,
    [string] $Profile = 'ae-dev-mfa'
)
$ErrorActionPreference = 'Continue'
$env:AWS_PAGER = ''
$aws = @('--profile', $Profile, '--region', 'us-east-1')
$iam = @('--profile', $Profile)
$account = '381003255014'
$region = 'us-east-1'
$bucket = 'aecp-dev-381003255014-us-east-1'
$secret = "arn:aws:secretsmanager:${region}:${account}:secret"
$cluster = 'aecp-dev-cms'
$service = 'aecp-dev-library-worker'
$logGroup = '/ecs/aecp-dev/library'
$models = @('us.anthropic.claude-haiku-5-5', 'us.anthropic.claude-sonnet-5-5')
function Invoke-Aws { $out = & aws @args; if ($LASTEXITCODE) { throw "aws $($args[0]) $($args[1]) failed" }; $out }

$vimeoSecret = Invoke-Aws secretsmanager describe-secret @aws --secret-id aecp-dev-library-vimeo-token --query ARN --output text
# ECS cannot start a task whose secret has no value. Until the owner stores the token, Vimeo jobs report vimeo_configuration_required.
$stages = & aws secretsmanager describe-secret @aws --secret-id aecp-dev-library-vimeo-token --query 'VersionIdsToStages' --output text
$vimeoReady = [bool]$stages -and $stages -ne 'None'
"Vimeo token stored: $vimeoReady"
$trust = @{ Version = '2012-10-17'; Statement = @(@{ Effect = 'Allow'; Principal = @{ Service = 'ecs-tasks.amazonaws.com' }; Action = 'sts:AssumeRole'
    Condition = @{ StringEquals = @{ 'aws:SourceAccount' = $account }; ArnLike = @{ 'aws:SourceArn' = "arn:aws:ecs:${region}:${account}:*" } } }) }
$execution = @{ Version = '2012-10-17'; Statement = @(
    @{ Effect = 'Allow'; Action = 'ecr:GetAuthorizationToken'; Resource = '*' },
    @{ Effect = 'Allow'; Action = @('ecr:BatchCheckLayerAvailability', 'ecr:GetDownloadUrlForLayer', 'ecr:BatchGetImage'); Resource = "arn:aws:ecr:${region}:${account}:repository/aecp-dev-cms" },
    @{ Effect = 'Allow'; Action = @('logs:CreateLogStream', 'logs:PutLogEvents'); Resource = "arn:aws:logs:${region}:${account}:log-group:${logGroup}:*" },
    @{ Effect = 'Allow'; Action = 'secretsmanager:GetSecretValue'; Resource = @("${secret}:aecp-dev-library-db-runtime-TKkby2", "${secret}:aecp-dev-library-payload-secret-JHvUB0", $vimeoSecret) }) }
# Inference profiles route to foundation models in several US regions; both resources are required.
$modelResources = foreach ($m in $models) { "arn:aws:bedrock:${region}:${account}:inference-profile/$m"; "arn:aws:bedrock:*::foundation-model/$($m.Substring(3))" }
$task = @{ Version = '2012-10-17'; Statement = @(
    @{ Sid = 'ReadOriginalsAndProcessingOutput'; Effect = 'Allow'; Action = 's3:GetObject'; Resource = @("arn:aws:s3:::$bucket/content/*", "arn:aws:s3:::$bucket/processing/*") },
    @{ Sid = 'WriteProcessingOutput'; Effect = 'Allow'; Action = 's3:PutObject'; Resource = @("arn:aws:s3:::$bucket/processing/*", "arn:aws:s3:::$bucket/content/*") },
    # Large Vimeo renditions stream to processing/vimeo/ by multipart upload; failed uploads are aborted.
    @{ Sid = 'AbortStagedMedia'; Effect = 'Allow'; Action = 's3:AbortMultipartUpload'; Resource = "arn:aws:s3:::$bucket/processing/*" },
    @{ Sid = 'Transcribe'; Effect = 'Allow'; Action = @('transcribe:StartTranscriptionJob', 'transcribe:GetTranscriptionJob'); Resource = '*' },
    @{ Sid = 'ApprovedTaggingModels'; Effect = 'Allow'; Action = @('bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream'); Resource = @($modelResources) },
    @{ Sid = 'OcrScannedPdfs'; Effect = 'Allow'; Action = @('textract:StartDocumentTextDetection', 'textract:GetDocumentTextDetection'); Resource = '*' },
    # Large uploads (over 50 MB) staged by the browser under uploads/: read, fingerprint, move into content/, delete.
    @{ Sid = 'FinalizeLargeUploads'; Effect = 'Allow'; Action = @('s3:GetObject', 's3:DeleteObject'); Resource = "arn:aws:s3:::$bucket/uploads/*" },
    @{ Sid = 'ListLargeUploads'; Effect = 'Allow'; Action = 's3:ListBucket'; Resource = "arn:aws:s3:::$bucket"; Condition = @{ StringLike = @{ 's3:prefix' = @('uploads/*') } } },
    @{ Sid = 'SemanticIndex'; Effect = 'Allow'; Action = 'bedrock:InvokeModel'; Resource = "arn:aws:bedrock:${region}::foundation-model/amazon.titan-embed-text-v2:0" }) }

$tmp = Join-Path $env:TEMP 'aecp-worker-iam'; New-Item -ItemType Directory -Force $tmp | Out-Null
try {
    [IO.File]::WriteAllText("$tmp\trust.json", ($trust | ConvertTo-Json -Depth 8))
    foreach ($role in @(@{ name = 'aecp-dev-library-worker-execution'; policy = 'DevLibraryExecution'; doc = $execution; description = 'AE Library dev worker: pull image, write logs, read DB and Vimeo secrets' },
                        @{ name = 'aecp-dev-library-worker-task'; policy = 'DevLibraryProcessing'; doc = $task; description = 'AE Library dev worker: S3 processing, Transcribe, approved Bedrock models' })) {
        $found = & aws iam list-roles @iam --query "Roles[?RoleName=='$($role.name)'].RoleName" --output text
        if (-not $found) { Invoke-Aws iam create-role @iam --role-name $role.name --description $role.description --assume-role-policy-document "file://$tmp\trust.json" `
            --tags 'Key=Project,Value=AEContentPlatform' 'Key=Environment,Value=dev' 'Key=Owner,Value=AE Content Platform' --query Role.Arn --output text }
        [IO.File]::WriteAllText("$tmp\$($role.policy).json", ($role.doc | ConvertTo-Json -Depth 8))
        Invoke-Aws iam put-role-policy @iam --role-name $role.name --policy-name $role.policy --policy-document "file://$tmp\$($role.policy).json" | Out-Null
    }
} finally { Remove-Item -Recurse -Force $tmp }
# New IAM roles take a few seconds to become assumable by ECS.
Start-Sleep 10

$definition = @{
    family = $service; networkMode = 'awsvpc'; requiresCompatibilities = @('FARGATE'); cpu = '512'; memory = '1024'
    runtimePlatform = @{ cpuArchitecture = 'X86_64'; operatingSystemFamily = 'LINUX' }
    executionRoleArn = "arn:aws:iam::${account}:role/aecp-dev-library-worker-execution"
    taskRoleArn = "arn:aws:iam::${account}:role/aecp-dev-library-worker-task"
    containerDefinitions = @(@{
        name = 'worker'; image = "$account.dkr.ecr.$region.amazonaws.com/aecp-dev-cms@$ImageDigest"; essential = $true
        entryPoint = @('node', '-e'); command = @([IO.File]::ReadAllText((Join-Path $PSScriptRoot 'worker.js')))
        environment = @(
            @{ name = 'PGHOST'; value = 'aecp-dev-postgres.cwgidnxxj114.us-east-1.rds.amazonaws.com' },
            @{ name = 'CONTENT_BUCKET'; value = $bucket },
            @{ name = 'AWS_REGION'; value = $region },
            # Dev ceiling chosen by the owner: paid steps allowed; Automation settings and the daily limit still apply.
            @{ name = 'ALLOW_PAID_PROCESSING'; value = 'true' },
            @{ name = 'BEDROCK_MODEL_IDS'; value = ($models -join ',') },
            # Embeds reviewed passages for semantic search (Titan Text Embeddings V2).
            @{ name = 'SEMANTIC_SEARCH'; value = 'true' })
        # PAYLOAD_SECRET: the worker registers large uploads through Payload, with the same rules as direct uploads.
        secrets = @(@{ name = 'DB_PASSWORD'; valueFrom = "${secret}:aecp-dev-library-db-runtime-TKkby2" },
                    @{ name = 'PAYLOAD_SECRET'; valueFrom = "${secret}:aecp-dev-library-payload-secret-JHvUB0" }) + $(if ($vimeoReady) { @(@{ name = 'VIMEO_ACCESS_TOKEN'; valueFrom = $vimeoSecret }) } else { @() })
        logConfiguration = @{ logDriver = 'awslogs'; options = @{ 'awslogs-group' = $logGroup; 'awslogs-region' = $region; 'awslogs-stream-prefix' = 'worker' } }
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
    # No inbound listener: the init security group has no ingress rules and is already allowed to reach RDS.
    Invoke-Aws ecs create-service @aws --cluster $cluster --service-name $service --task-definition $taskDefinition --desired-count 1 --launch-type FARGATE `
        --network-configuration 'awsvpcConfiguration={subnets=[subnet-0065c49d9550686c6,subnet-0c59417bf207bca9c],securityGroups=[sg-0bdbe5d2db5acacf6],assignPublicIp=DISABLED}' `
        --deployment-configuration 'minimumHealthyPercent=0,maximumPercent=100,deploymentCircuitBreaker={enable=true,rollback=true}' `
        --propagate-tags SERVICE --tags 'key=Project,value=AEContentPlatform' 'key=Environment,value=dev' 'key=Owner,value=AE Content Platform' `
        --query 'service.serviceName' --output text | Out-Null
    "Created $service"
}
"Waiting for the worker to stabilize..."
Invoke-Aws ecs wait services-stable @aws --cluster $cluster --services $service | Out-Null
Invoke-Aws ecs describe-services @aws --cluster $cluster --services $service --query 'services[0].{running:runningCount,desired:desiredCount,rollout:deployments[0].rolloutState,taskDefinition:taskDefinition}' --output json
