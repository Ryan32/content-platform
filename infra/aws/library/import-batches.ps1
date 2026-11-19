<#
Runs a locally built set of WordPress import batches against the AE Library dev database, end to end:
  1. checks every batch's files against its complete.json checksums,
  2. creates/updates the import task role (read imports/*, write content/* files only),
  3. uploads each package to s3://<dev bucket>/imports/<packageId>/ and the verified files to imports/files/,
  4. runs ONE one-off ECS task that, per batch, validates -> previews -> (apply -> rerun no-op -> attach files),
  5. prints the task's sanitized log and exits non-zero on failure.
Safe to rerun: uploads overwrite identical bytes and completed packages are skipped by the importer.

Usage (repo root, AWS laptop):
  .\infra\aws\library\import-batches.ps1 -BatchDir <folder with batches.json> -OperationsDigest sha256:<operations image> [-PreviewOnly] [-Only batch-001,batch-002]

Build batches on the laptop that holds data\dbr-backup:
  python scripts/build_wordpress_import.py batch --output data/wordpress-import/batches/<new-name>
#>
param(
    [Parameter(Mandatory)] [string] $BatchDir,
    # Linux/amd64 manifest digest of the operations image built from the current commit (must include the latest migration).
    [Parameter(Mandatory)] [ValidatePattern('^sha256:[0-9a-f]{64}$')] [string] $OperationsDigest,
    [switch] $PreviewOnly,
    [string[]] $Only,
    [string] $Profile = 'ae-dev-mfa'
)
$ErrorActionPreference = 'Stop'
$env:AWS_PAGER = ''
$aws = @('--profile', $Profile, '--region', 'us-east-1')
$iam = @('--profile', $Profile)
$account = '381003255014'
$region = 'us-east-1'
$bucket = 'aecp-dev-381003255014-us-east-1'
$secret = "arn:aws:secretsmanager:${region}:${account}:secret"
$cluster = 'aecp-dev-cms'
$logGroup = '/ecs/aecp-dev/library'
$subnets = 'subnet-0065c49d9550686c6,subnet-0c59417bf207bca9c'
$webSecurityGroup = 'sg-0c6e301657f022b7c' # Same database access path as the web/smoke tasks.
$taskRole = 'aecp-dev-library-import-task'
$files = 'complete.json', 'package.json', 'summary.json', 'dry-run.json'
function Invoke-Aws { $out = & aws @args; if ($LASTEXITCODE) { throw "aws $($args[0]) $($args[1]) failed" }; $out }

# 1. Local verification: every batch is complete and unmodified since it was built.
$manifestPath = Join-Path $BatchDir 'batches.json'
if (-not (Test-Path -LiteralPath $manifestPath)) { throw "No batches.json in $BatchDir" }
$manifest = Get-Content -Raw -LiteralPath $manifestPath | ConvertFrom-Json
if ($manifest.schema -ne 'ae-wordpress-batches/1') { throw 'Unexpected batches.json schema' }
$batches = @($manifest.batches | Where-Object { -not $Only -or $Only -contains $_.batch })
if (-not $batches) { throw 'No batches selected' }
foreach ($b in $batches) {
    if ($b.packageId -notmatch '^[0-9a-f]{64}$') { throw "Bad package ID for $($b.batch)" }
    $dir = Join-Path $BatchDir $b.batch
    $complete = Get-Content -Raw -LiteralPath (Join-Path $dir 'complete.json') | ConvertFrom-Json
    foreach ($name in 'package.json', 'summary.json', 'dry-run.json') {
        $expected = "$($complete.files.$name)" -replace '^sha256:', ''
        $actual = (Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $dir $name)).Hash.ToLowerInvariant()
        if (-not $expected -or $actual -ne $expected.ToLowerInvariant()) { throw "$($b.batch)/$name does not match complete.json; rebuild or recopy the batch" }
    }
}
foreach ($f in @($manifest.files)) {
    if (-not $f) { continue }
    if ($f.file -notmatch '^[0-9a-f]{64}\.[a-z0-9]{1,8}$') { throw "Bad file name in batches.json: $($f.file)" }
    $actual = (Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path (Join-Path $BatchDir 'files') $f.file)).Hash.ToLowerInvariant()
    if ($actual -ne $f.sha256) { throw "files/$($f.file) does not match its fingerprint; recopy the batch folder" }
}
"Verified $($batches.Count) batch(es), $(($batches | Measure-Object records -Sum).Sum) records"

# 2. Import task role: read-only on the imports/ prefix, nothing else.
$trust = @{ Version = '2012-10-17'; Statement = @(@{ Effect = 'Allow'; Principal = @{ Service = 'ecs-tasks.amazonaws.com' }; Action = 'sts:AssumeRole'
    Condition = @{ StringEquals = @{ 'aws:SourceAccount' = $account }; ArnLike = @{ 'aws:SourceArn' = "arn:aws:ecs:${region}:${account}:*" } } }) }
$policy = @{ Version = '2012-10-17'; Statement = @(
    @{ Sid = 'ReadImportPackages'; Effect = 'Allow'; Action = 's3:GetObject'; Resource = "arn:aws:s3:::$bucket/imports/*" },
    # Attach step: copy verified files into each item's immutable content/<id>/<sha256>.<ext> key.
    @{ Sid = 'AttachFiles'; Effect = 'Allow'; Action = @('s3:GetObject', 's3:PutObject'); Resource = "arn:aws:s3:::$bucket/content/*" }) }
$tmp = Join-Path $env:TEMP 'aecp-import'; New-Item -ItemType Directory -Force $tmp | Out-Null
try {
    [IO.File]::WriteAllText("$tmp\trust.json", ($trust | ConvertTo-Json -Depth 8))
    [IO.File]::WriteAllText("$tmp\policy.json", ($policy | ConvertTo-Json -Depth 8))
    $found = & aws iam list-roles @iam --query "Roles[?RoleName=='$taskRole'].RoleName" --output text
    if (-not $found) {
        Invoke-Aws iam create-role @iam --role-name $taskRole --description 'AE Library dev import task: read private import packages' `
            --assume-role-policy-document "file://$tmp\trust.json" --tags 'Key=Project,Value=AEContentPlatform' 'Key=Environment,Value=dev' 'Key=Owner,Value=AE Content Platform' --query Role.Arn --output text | Out-Null
        Invoke-Aws iam put-role-policy @iam --role-name $taskRole --policy-name DevLibraryImportRead --policy-document "file://$tmp\policy.json" | Out-Null
        Start-Sleep 10 # New roles take a few seconds to become assumable by ECS.
    } else {
        Invoke-Aws iam put-role-policy @iam --role-name $taskRole --policy-name DevLibraryImportRead --policy-document "file://$tmp\policy.json" | Out-Null
    }
    "Import task role ready: $taskRole"

    # 3. Upload packages (private bucket, SSE-S3).
    foreach ($b in $batches) {
        foreach ($name in $files) {
            Invoke-Aws s3 cp (Join-Path (Join-Path $BatchDir $b.batch) $name) "s3://$bucket/imports/$($b.packageId)/$name" @aws --sse AES256 --only-show-errors | Out-Null
        }
        "Uploaded $($b.batch) -> imports/$($b.packageId.Substring(0, 12))..."
    }
    if ($manifest.files -and -not $PreviewOnly) {
        $filesDir = Join-Path $BatchDir 'files'
        "Uploading $($manifest.files.Count) files ($([math]::Round((($manifest.files | Measure-Object bytes -Sum).Sum) / 1GB, 2)) GB; unchanged files are skipped)..."
        Invoke-Aws s3 sync $filesDir "s3://$bucket/imports/files/" @aws --sse AES256 --exclude '*.partial' --only-show-errors | Out-Null
        "Files uploaded"
    }

    # 4. One task for all batches, in order.
    $mode = if ($PreviewOnly) { 'preview' } else { 'apply' }
    $family = 'aecp-dev-library-import'
    $definition = @{
        family = $family; networkMode = 'awsvpc'; requiresCompatibilities = @('FARGATE'); cpu = '1024'; memory = '2048'
        runtimePlatform = @{ cpuArchitecture = 'X86_64'; operatingSystemFamily = 'LINUX' }
        executionRoleArn = "arn:aws:iam::${account}:role/aecp-dev-library-web-execution"
        taskRoleArn = "arn:aws:iam::${account}:role/$taskRole"
        containerDefinitions = @(@{
            name = 'library'; image = "$account.dkr.ecr.$region.amazonaws.com/aecp-dev-cms@$OperationsDigest"; essential = $true
            entryPoint = @('node', '-e'); command = @([IO.File]::ReadAllText((Join-Path $PSScriptRoot 'import.js')))
            environment = @(
                @{ name = 'PGHOST'; value = 'aecp-dev-postgres.cwgidnxxj114.us-east-1.rds.amazonaws.com' },
                @{ name = 'AWS_REGION'; value = $region },
                @{ name = 'IMPORT_BUCKET'; value = $bucket },
                @{ name = 'IMPORT_MODE'; value = $mode },
                @{ name = 'IMPORT_PACKAGE_IDS'; value = ($batches.packageId -join ',') })
            secrets = @(@{ name = 'DB_PASSWORD'; valueFrom = "${secret}:aecp-dev-library-db-runtime-TKkby2" },
                        @{ name = 'PAYLOAD_SECRET'; valueFrom = "${secret}:aecp-dev-library-payload-secret-JHvUB0" })
            readonlyRootFilesystem = $false
            logConfiguration = @{ logDriver = 'awslogs'; options = @{ 'awslogs-group' = $logGroup; 'awslogs-region' = $region; 'awslogs-stream-prefix' = 'import' } }
        })
        tags = @(@{ key = 'Project'; value = 'AEContentPlatform' }, @{ key = 'Environment'; value = 'dev' }, @{ key = 'Owner'; value = 'AE Content Platform' })
    }
    [IO.File]::WriteAllText("$tmp\task.json", ($definition | ConvertTo-Json -Depth 10))
    $taskDefinition = Invoke-Aws ecs register-task-definition @aws --cli-input-json "file://$tmp\task.json" --query taskDefinition.taskDefinitionArn --output text
} finally { Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue }
"Registered $taskDefinition ($mode)"

$network = "awsvpcConfiguration={subnets=[$subnets],securityGroups=[$webSecurityGroup],assignPublicIp=DISABLED}"
$task = Invoke-Aws ecs run-task @aws --cluster $cluster --launch-type FARGATE --task-definition $taskDefinition --network-configuration $network --started-by 'library-import' --query 'tasks[0].taskArn' --output text
if (-not $task -or $task -eq 'None') { throw 'Task did not start' }
"Started $task - waiting (about 1-2 min per batch)..."
# The CLI waiter gives up after 10 minutes; keep waiting while the task is still running.
do { & aws ecs wait tasks-stopped @aws --cluster $cluster --tasks $task 2>$null
     $status = Invoke-Aws ecs describe-tasks @aws --cluster $cluster --tasks $task --query 'tasks[0].lastStatus' --output text } while ($status -ne 'STOPPED')
$result = Invoke-Aws ecs describe-tasks @aws --cluster $cluster --tasks $task --query "tasks[0].{stopped:stoppedReason,exit:containers[?name=='library'].exitCode|[0],reason:containers[?name=='library'].reason|[0]}" --output json | ConvertFrom-Json

# 5. Sanitized log output.
$taskId = $task.Split('/')[-1]
$env:PYTHONUTF8 = '1'
$previousEncoding = [Console]::OutputEncoding
[Console]::OutputEncoding = [Text.Encoding]::UTF8
try {
    $messages = aws logs get-log-events @aws --log-group-name $logGroup --log-stream-name "import/library/$taskId" --start-from-head --query 'events[].message' --output json | ConvertFrom-Json
} finally { [Console]::OutputEncoding = $previousEncoding }
"--- $logGroup/import/library/$taskId"
$messages | ForEach-Object { $_ -replace '[^\x09\x20-\x7E]', '?' }
"Exit code: $($result.exit); stopped: $($result.stopped); reason: $($result.reason)"
if ($result.exit -ne 0) { exit 1 }
