<#
Registers and runs one AE Library dev one-off ECS task, waits for it, and prints its sanitized log output.
Usage: .\infra\aws\library\run-task.ps1 -Step bootstrap|migrate|smoke [-Profile ae-dev-mfa]
Runs in the private app subnets with no public IP. Secrets are injected by ECS from Secrets Manager.
#>
param(
    [Parameter(Mandatory)] [ValidateSet('bootstrap', 'migrate', 'smoke', 'retire-initial-cms', 'provision-admin')] [string] $Step,
    # Auth0 user_id for -Step provision-admin.
    [string] $AdminSubject,
    # Linux/amd64 manifest digests in aecp-dev-cms; defaults are the currently deployed release.
    [ValidatePattern('^sha256:[0-9a-f]{64}$')] [string] $OperationsDigest = 'sha256:3df8a57f477a46d58e641e5ffdefbeb77a54b1537023d68c06e109e62772d6e4',
    [ValidatePattern('^sha256:[0-9a-f]{64}$')] [string] $RuntimeDigest = 'sha256:b9cc25b56e4dd6e4a36d44a102d3b701ff8cd9f0d14589554de56aaa6dbad32a',
    [string] $Profile = 'ae-dev-mfa'
)
$ErrorActionPreference = 'Stop'
$env:AWS_PAGER = ''
$aws = @('--profile', $Profile, '--region', 'us-east-1')
$account = '381003255014'
$repo = "$account.dkr.ecr.us-east-1.amazonaws.com/aecp-dev-cms"
$secret = "arn:aws:secretsmanager:us-east-1:${account}:secret"
$dbHost = 'aecp-dev-postgres.cwgidnxxj114.us-east-1.rds.amazonaws.com'
$logGroup = '/ecs/aecp-dev/library'
$subnets = 'subnet-0065c49d9550686c6,subnet-0c59417bf207bca9c'

$operationsImage = "$repo@$OperationsDigest"
$runtimeImage = "$repo@$RuntimeDigest"

$steps = @{
    bootstrap = @{ image = $operationsImage; role = 'aecp-dev-library-bootstrap-execution'; sg = 'sg-0bdbe5d2db5acacf6'; cpu = '512'; memory = '1024'
        secrets = @(@{ name = 'DB_MASTER'; valueFrom = "${secret}:rds!db-86651c52-f5b7-4dd7-94ac-7a01f6adfdd9-Zd8jGE" },
                    @{ name = 'RUNTIME_PASSWORD'; valueFrom = "${secret}:aecp-dev-library-db-runtime-TKkby2" },
                    @{ name = 'MIGRATION_PASSWORD'; valueFrom = "${secret}:aecp-dev-library-db-migration-O8TFVh" })
        environment = @() }
    'retire-initial-cms' = @{ image = $operationsImage; role = 'aecp-dev-library-bootstrap-execution'; sg = 'sg-0bdbe5d2db5acacf6'; cpu = '512'; memory = '1024'
        secrets = @(@{ name = 'DB_MASTER'; valueFrom = "${secret}:rds!db-86651c52-f5b7-4dd7-94ac-7a01f6adfdd9-Zd8jGE" })
        environment = @() }
    'provision-admin' = @{ image = $operationsImage; role = 'aecp-dev-library-migration-execution'; sg = 'sg-0bdbe5d2db5acacf6'; cpu = '512'; memory = '1024'
        secrets = @(@{ name = 'DB_PASSWORD'; valueFrom = "${secret}:aecp-dev-library-db-migration-O8TFVh" })
        environment = @(@{ name = 'ADMIN_SUBJECT'; value = "$AdminSubject" }, @{ name = 'ADMIN_ISSUER'; value = 'https://auth-dev.advisorsexcel.com/' }) }
    migrate = @{ image = $operationsImage; role = 'aecp-dev-library-migration-execution'; sg = 'sg-0bdbe5d2db5acacf6'; cpu = '1024'; memory = '2048'
        secrets = @(@{ name = 'DB_PASSWORD'; valueFrom = "${secret}:aecp-dev-library-db-migration-O8TFVh" },
                    @{ name = 'PAYLOAD_SECRET'; valueFrom = "${secret}:aecp-dev-library-payload-secret-JHvUB0" })
        environment = @() }
    smoke = @{ image = $runtimeImage; role = 'aecp-dev-library-web-execution'; sg = 'sg-0c6e301657f022b7c'; cpu = '1024'; memory = '2048'
        secrets = @(@{ name = 'DB_PASSWORD'; valueFrom = "${secret}:aecp-dev-library-db-runtime-TKkby2" },
                    @{ name = 'PAYLOAD_SECRET'; valueFrom = "${secret}:aecp-dev-library-payload-secret-JHvUB0" })
        # Auth0 is not configured yet; the issuer is a non-resolving placeholder so protected routes fail closed.
        environment = @(@{ name = 'PLATFORM_ORIGIN'; value = 'https://library-dev.advisorsexcel.com' },
                        @{ name = 'AUTH0_ISSUER'; value = 'https://auth0-not-configured.invalid/' },
                        @{ name = 'AUTH0_AUDIENCE'; value = 'https://library-dev.advisorsexcel.com/mcp' }) }
}
$config = $steps[$Step]
$script = [IO.File]::ReadAllText((Join-Path $PSScriptRoot "$Step.js"))
$family = "aecp-dev-library-$Step"
$definition = @{
    family = $family; networkMode = 'awsvpc'; requiresCompatibilities = @('FARGATE'); cpu = $config.cpu; memory = $config.memory
    runtimePlatform = @{ cpuArchitecture = 'X86_64'; operatingSystemFamily = 'LINUX' }
    executionRoleArn = "arn:aws:iam::${account}:role/$($config.role)"
    containerDefinitions = @(@{
        name = 'library'; image = $config.image; essential = $true
        entryPoint = @('node', '-e'); command = @($script)
        environment = @(@{ name = 'PGHOST'; value = $dbHost }) + $config.environment
        secrets = $config.secrets
        readonlyRootFilesystem = $false
        logConfiguration = @{ logDriver = 'awslogs'; options = @{ 'awslogs-group' = $logGroup; 'awslogs-region' = 'us-east-1'; 'awslogs-stream-prefix' = $Step } }
    })
    tags = @(@{ key = 'Project'; value = 'AEContentPlatform' }, @{ key = 'Environment'; value = 'dev' }, @{ key = 'Owner'; value = 'AE Content Platform' })
}
$file = Join-Path $env:TEMP "$family.json"
[IO.File]::WriteAllText($file, ($definition | ConvertTo-Json -Depth 10))
try {
    $taskDefinition = aws ecs register-task-definition @aws --cli-input-json "file://$file" --query taskDefinition.taskDefinitionArn --output text
    if ($LASTEXITCODE) { throw 'Task definition registration failed' }
} finally { Remove-Item -LiteralPath $file -ErrorAction SilentlyContinue }
"Registered $taskDefinition"

$network = "awsvpcConfiguration={subnets=[$subnets],securityGroups=[$($config.sg)],assignPublicIp=DISABLED}"
$task = aws ecs run-task @aws --cluster aecp-dev-cms --launch-type FARGATE --task-definition $taskDefinition --network-configuration $network --started-by "library-$Step" --query 'tasks[0].taskArn' --output text
if ($LASTEXITCODE -or -not $task -or $task -eq 'None') { throw 'Task did not start' }
"Started $task"
aws ecs wait tasks-stopped @aws --cluster aecp-dev-cms --tasks $task
$result = aws ecs describe-tasks @aws --cluster aecp-dev-cms --tasks $task --query "tasks[0].{stopped:stoppedReason,exit:containers[?name=='library'].exitCode|[0],reason:containers[?name=='library'].reason|[0]}" --output json | ConvertFrom-Json
$taskId = $task.Split('/')[-1]
Write-Output "--- $logGroup/$Step/library/$taskId"
# Next.js logs non-ASCII glyphs; force UTF-8 from the AWS CLI and print ASCII-safe text.
$env:PYTHONUTF8 = '1'
$previousEncoding = [Console]::OutputEncoding
[Console]::OutputEncoding = [Text.Encoding]::UTF8
try {
    $messages = aws logs get-log-events @aws --log-group-name $logGroup --log-stream-name "$Step/library/$taskId" --start-from-head --query 'events[].message' --output json | ConvertFrom-Json
} finally { [Console]::OutputEncoding = $previousEncoding }
$messages | ForEach-Object { $_ -replace '[^\x09\x20-\x7E]', '?' }
"Exit code: $($result.exit); stopped: $($result.stopped); reason: $($result.reason)"
if ($result.exit -ne 0) { exit 1 }
