<#
Creates the AE Library dev analytics lake: Amazon S3 Tables (managed Apache Iceberg) + one Amazon Data Firehose stream per
table. The worker ships its analytics outbox to these streams (ANALYTICS_FIREHOSE_PREFIX=aecp-dev-library); Snowflake reads
the tables in place through a catalog-linked database (see docs/AI-PIPELINE.md, "Snowflake").

Idempotent: existing bucket, namespace, tables, role and streams are kept. Tables are append-only; nothing is deleted.
Usage: .\infra\aws\library\analytics-iceberg.ps1 [-Profile ae-dev-mfa]

Prerequisite (once per account/region, console): S3 -> Table buckets -> "Enable integration" with AWS analytics services.
That creates the Glue catalog `s3tablescatalog` Firehose writes through. The script checks for it and stops if missing.
Verified against AWS docs 2026-11-18: Firehose -> S3 Tables uses CatalogARN arn:aws:glue:<region>:<account>:catalog/s3tablescatalog/<bucket>.
#>
param([string] $Profile = 'ae-dev-mfa')
$ErrorActionPreference = 'Stop'
$env:AWS_PAGER = ''
$aws = @('--profile', $Profile, '--region', 'us-east-1')
$iam = @('--profile', $Profile)
$account = '381003255014'
$region = 'us-east-1'
$tableBucket = 'aecp-dev-library-analytics'
$namespace = 'library'
$streamPrefix = 'aecp-dev-library'
$errorBucket = 'aecp-dev-381003255014-us-east-1'   # Firehose delivery errors under analytics-errors/
$role = 'aecp-dev-library-analytics-firehose'
function Invoke-Aws { $out = & aws @args; if ($LASTEXITCODE) { throw "aws $($args[0]) $($args[1]) failed" }; $out }
$tmp = Join-Path $env:TEMP 'aecp-analytics'; New-Item -ItemType Directory -Force $tmp | Out-Null

# Columns shared by every table; `payload` always holds the complete row as JSON text, so nothing is lost to mapping.
$common = @(
    @{ name = 'outbox_id'; type = 'long'; required = $true }, @{ name = 'occurred_at'; type = 'timestamptz'; required = $true },
    @{ name = 'event'; type = 'string'; required = $true }, @{ name = 'content_id'; type = 'int' }, @{ name = 'job_id'; type = 'int' },
    @{ name = 'actor'; type = 'string' }, @{ name = 'environment'; type = 'string' }, @{ name = 'payload'; type = 'string' })
$tables = [ordered]@{
    events = @(@{ name = 'kind'; type = 'string' }, @{ name = 'source_version'; type = 'string' }, @{ name = 'attempts'; type = 'int' }, @{ name = 'error_code'; type = 'string' },
        @{ name = 'processor'; type = 'string' }, @{ name = 'model'; type = 'string' }, @{ name = 'decision'; type = 'string' }, @{ name = 'suggestion_id'; type = 'int' })
    model_calls = @(@{ name = 'purpose'; type = 'string' }, @{ name = 'model'; type = 'string' }, @{ name = 'prompt_version'; type = 'string' }, @{ name = 'stop_reason'; type = 'string' },
        @{ name = 'input_tokens'; type = 'int' }, @{ name = 'output_tokens'; type = 'int' }, @{ name = 'latency_ms'; type = 'int' }, @{ name = 'evidence_key'; type = 'string' })
    evidence = @(@{ name = 'kind'; type = 'string' }, @{ name = 'processor'; type = 'string' }, @{ name = 'asset_id'; type = 'int' }, @{ name = 's3_key'; type = 'string' },
        @{ name = 'sha256'; type = 'string' }, @{ name = 'bytes'; type = 'long' })
    chunks = @(@{ name = 'chunk_id'; type = 'long' }, @{ name = 'build_version'; type = 'string' }, @{ name = 'seq'; type = 'int' }, @{ name = 'source'; type = 'string' },
        @{ name = 'weight'; type = 'float' }, @{ name = 'asset_id'; type = 'int' }, @{ name = 'citation_id'; type = 'string' }, @{ name = 'locator'; type = 'string' },
        @{ name = 'text'; type = 'string' }, @{ name = 'embedding_model'; type = 'string' },
        @{ name = 'embedding'; type = @{ type = 'list'; 'element-id' = 1000; element = 'float'; 'element-required' = $false } })
    items = @(@{ name = 'state'; type = 'string' }, @{ name = 'title'; type = 'string' }, @{ name = 'summary'; type = 'string' }, @{ name = 'evidence_version'; type = 'string' },
        @{ name = 'build_version'; type = 'string' }, @{ name = 'chunk_count'; type = 'int' })
}

try {
    # 0. The S3 Tables <-> AWS analytics integration (Glue catalog) must exist.
    & aws glue get-catalog @aws --catalog-id "${account}:s3tablescatalog" --query 'Catalog.Name' --output text 2>$null | Out-Null
    if ($LASTEXITCODE) { throw 'S3 Tables integration with AWS analytics services is not enabled. Enable it in the S3 console (Table buckets -> Enable integration), then rerun.' }

    # 1. Table bucket and namespace.
    $bucketArn = & aws s3tables list-table-buckets @aws --query "tableBuckets[?name=='$tableBucket'].arn | [0]" --output text
    if (-not $bucketArn -or $bucketArn -eq 'None') { $bucketArn = Invoke-Aws s3tables create-table-bucket @aws --name $tableBucket --query arn --output text; "Created table bucket $tableBucket" }
    & aws s3tables get-namespace @aws --table-bucket-arn $bucketArn --namespace $namespace 2>$null | Out-Null
    if ($LASTEXITCODE) { Invoke-Aws s3tables create-namespace @aws --table-bucket-arn $bucketArn --namespace $namespace | Out-Null; "Created namespace $namespace" }

    # 2. Iceberg tables (append-only).
    foreach ($name in $tables.Keys) {
        & aws s3tables get-table @aws --table-bucket-arn $bucketArn --namespace $namespace --name $name 2>$null | Out-Null
        if (-not $LASTEXITCODE) { "Table $namespace.$name exists"; continue }
        $id = 0
        $fields = @($common + $tables[$name]) | ForEach-Object { $id++; [ordered]@{ id = $id; name = $_.name; type = $_.type; required = [bool]$_.required } }
        $metadata = @{ iceberg = @{ schema = @{ type = 'struct'; fields = $fields } } }
        [IO.File]::WriteAllText("$tmp\$name.json", ($metadata | ConvertTo-Json -Depth 10))
        Invoke-Aws s3tables create-table @aws --table-bucket-arn $bucketArn --namespace $namespace --name $name --format ICEBERG --metadata "file://$tmp\$name.json" | Out-Null
        "Created table $namespace.$name"
    }

    # 3. Firehose role: write to these tables through the s3tablescatalog, errors to analytics-errors/.
    $trust = @{ Version = '2012-10-17'; Statement = @(@{ Effect = 'Allow'; Principal = @{ Service = 'firehose.amazonaws.com' }; Action = 'sts:AssumeRole'
        Condition = @{ StringEquals = @{ 'sts:ExternalId' = $account } } }) }
    $policy = @{ Version = '2012-10-17'; Statement = @(
        @{ Sid = 'GlueCatalog'; Effect = 'Allow'; Action = @('glue:GetTable', 'glue:GetDatabase', 'glue:UpdateTable')
           Resource = @("arn:aws:glue:${region}:${account}:catalog", "arn:aws:glue:${region}:${account}:catalog/s3tablescatalog", "arn:aws:glue:${region}:${account}:catalog/s3tablescatalog/*",
                        "arn:aws:glue:${region}:${account}:database/s3tablescatalog/$tableBucket/$namespace", "arn:aws:glue:${region}:${account}:table/s3tablescatalog/$tableBucket/$namespace/*") },
        @{ Sid = 'S3TablesData'; Effect = 'Allow'; Action = @('s3tables:GetTableData', 's3tables:PutTableData', 's3tables:GetTableMetadataLocation', 's3tables:UpdateTableMetadataLocation', 's3tables:GetNamespace', 's3tables:GetTable')
           Resource = @($bucketArn, "$bucketArn/*") },
        @{ Sid = 'LakeFormationData'; Effect = 'Allow'; Action = 'lakeformation:GetDataAccess'; Resource = '*' },
        @{ Sid = 'DeliveryErrors'; Effect = 'Allow'; Action = @('s3:PutObject', 's3:AbortMultipartUpload', 's3:GetBucketLocation', 's3:ListBucket')
           Resource = @("arn:aws:s3:::$errorBucket", "arn:aws:s3:::$errorBucket/analytics-errors/*") }) }
    [IO.File]::WriteAllText("$tmp\trust.json", ($trust | ConvertTo-Json -Depth 8))
    [IO.File]::WriteAllText("$tmp\policy.json", ($policy | ConvertTo-Json -Depth 8))
    $found = & aws iam list-roles @iam --query "Roles[?RoleName=='$role'].RoleName" --output text
    if (-not $found) { Invoke-Aws iam create-role @iam --role-name $role --assume-role-policy-document "file://$tmp\trust.json" --description 'AE Library dev analytics: Firehose to S3 Tables' `
        --tags 'Key=Project,Value=AEContentPlatform' 'Key=Environment,Value=dev' 'Key=Owner,Value=AE Content Platform' | Out-Null; Start-Sleep 10 }
    Invoke-Aws iam put-role-policy @iam --role-name $role --policy-name DevLibraryAnalyticsDelivery --policy-document "file://$tmp\policy.json" | Out-Null
    $roleArn = "arn:aws:iam::${account}:role/$role"
    "Firehose role ready: $role"
    "If Lake Formation governs s3tablescatalog in this account, grant this role DESCRIBE/SELECT/INSERT/ALTER on $namespace tables (see docs/AI-PIPELINE.md)."

    # 4. One Firehose stream per table.
    foreach ($name in $tables.Keys) {
        $stream = "$streamPrefix-$($name.Replace('_', '-'))"
        & aws firehose describe-delivery-stream @aws --delivery-stream-name $stream 2>$null | Out-Null
        if (-not $LASTEXITCODE) { "Stream $stream exists"; continue }
        $config = @{ RoleARN = $roleArn; CatalogConfiguration = @{ CatalogARN = "arn:aws:glue:${region}:${account}:catalog/s3tablescatalog/$tableBucket" }
            DestinationTableConfigurationList = @(@{ DestinationDatabaseName = $namespace; DestinationTableName = $name })
            BufferingHints = @{ IntervalInSeconds = 300; SizeInMBs = 64 }
            S3Configuration = @{ RoleARN = $roleArn; BucketARN = "arn:aws:s3:::$errorBucket"; ErrorOutputPrefix = "analytics-errors/$name/" } }
        [IO.File]::WriteAllText("$tmp\stream.json", ($config | ConvertTo-Json -Depth 8))
        Invoke-Aws firehose create-delivery-stream @aws --delivery-stream-name $stream --delivery-stream-type DirectPut --iceberg-destination-configuration "file://$tmp\stream.json" `
            --tags 'Key=Project,Value=AEContentPlatform' 'Key=Environment,Value=dev' | Out-Null
        "Created stream $stream -> $namespace.$name"
    }
    "Table bucket ARN (for Snowflake CATALOG_NAME): $bucketArn"
} finally { Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue }
