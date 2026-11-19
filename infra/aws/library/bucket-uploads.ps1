<#
Prepares the dev content bucket for large browser uploads (files over 50 MB go straight to S3 under uploads/):
  - CORS: allow PUT from the library origin only, with exactly the headers the signed upload requires;
  - lifecycle: expire abandoned staging uploads after 2 days and incomplete multipart uploads after 1 day.
Existing CORS rules and lifecycle rules are kept; only the rules with these IDs are added or replaced. Idempotent.
Usage: .\infra\aws\library\bucket-uploads.ps1 [-Profile ae-dev-mfa]
#>
param([string] $Profile = 'ae-dev-mfa', [string] $Origin = 'https://library-dev.advisorsexcel.com')
$ErrorActionPreference = 'Stop'
$env:AWS_PAGER = ''
$aws = @('--profile', $Profile, '--region', 'us-east-1')
$bucket = 'aecp-dev-381003255014-us-east-1'
function Invoke-Aws { $out = & aws @args; if ($LASTEXITCODE) { throw "aws $($args[0]) $($args[1]) failed" }; $out }
$tmp = Join-Path $env:TEMP 'aecp-bucket-uploads'; New-Item -ItemType Directory -Force $tmp | Out-Null
try {
    # CORS
    $existing = & aws s3api get-bucket-cors @aws --bucket $bucket --output json 2>$null
    $rules = @(if ($LASTEXITCODE -eq 0 -and $existing) { ($existing | ConvertFrom-Json).CORSRules | Where-Object { $_.ID -ne 'ae-library-uploads' } })
    $rules += [pscustomobject]@{ ID = 'ae-library-uploads'; AllowedMethods = @('PUT'); AllowedOrigins = @($Origin)
        AllowedHeaders = @('content-type', 'x-amz-server-side-encryption', 'x-amz-meta-uploaded-by'); ExposeHeaders = @('ETag'); MaxAgeSeconds = 3000 }
    [IO.File]::WriteAllText("$tmp\cors.json", (@{ CORSRules = $rules } | ConvertTo-Json -Depth 6))
    Invoke-Aws s3api put-bucket-cors @aws --bucket $bucket --cors-configuration "file://$tmp\cors.json" | Out-Null
    "CORS: PUT allowed from $Origin ($($rules.Count) rule(s) total)"

    # Lifecycle
    $existing = & aws s3api get-bucket-lifecycle-configuration @aws --bucket $bucket --output json 2>$null
    $lifecycle = @(if ($LASTEXITCODE -eq 0 -and $existing) { ($existing | ConvertFrom-Json).Rules | Where-Object { $_.ID -ne 'expire-abandoned-uploads' } })
    $lifecycle += [pscustomobject]@{ ID = 'expire-abandoned-uploads'; Status = 'Enabled'; Filter = @{ Prefix = 'uploads/' }
        Expiration = @{ Days = 2 }; AbortIncompleteMultipartUpload = @{ DaysAfterInitiation = 1 } }
    [IO.File]::WriteAllText("$tmp\lifecycle.json", (@{ Rules = $lifecycle } | ConvertTo-Json -Depth 8))
    Invoke-Aws s3api put-bucket-lifecycle-configuration @aws --bucket $bucket --lifecycle-configuration "file://$tmp\lifecycle.json" | Out-Null
    "Lifecycle: uploads/ expire after 2 days ($($lifecycle.Count) rule(s) total: $(($lifecycle.ID) -join ', '))"
} finally { Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue }
