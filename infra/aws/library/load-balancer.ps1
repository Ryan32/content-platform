<#
Creates (or reuses) the AE Library dev HTTPS entry point in the existing Web Hosting VPC:
ALB security group, app security group, RDS ingress for the app, target group, internet-facing ALB,
HTTPS listener with the ACM certificate, and an HTTP->HTTPS redirect. Ingress is limited to -AllowedCidr.
Usage: .\infra\aws\library\load-balancer.ps1 -AllowedCidr 203.0.113.10/32 [-Profile ae-dev-mfa]
#>
param(
    [Parameter(Mandatory)] [string[]] $AllowedCidr,
    [string] $Profile = 'ae-dev-mfa'
)
# Native-command failures are checked via $LASTEXITCODE; 'Stop' would turn expected "not found" stderr into terminating errors in Windows PowerShell.
$ErrorActionPreference = 'Continue'
$env:AWS_PAGER = ''
$aws = @('--profile', $Profile, '--region', 'us-east-1')
$vpc = 'vpc-e4c01f81'
$publicSubnets = @('subnet-0cdef3ed7b796839c', 'subnet-0fc2edad2aac0c6d1')
$rdsSecurityGroup = 'sg-0ccafd453d21f8891'
$certificate = 'arn:aws:acm:us-east-1:381003255014:certificate/4dd670cf-3d34-41f7-8203-fd33cb7d7f2e'
$tags = @('Key=Project,Value=AEContentPlatform', 'Key=Environment,Value=dev', 'Key=Owner,Value=AE Content Platform')
function Invoke-Aws { $out = & aws @args; if ($LASTEXITCODE) { throw "aws $($args[0]) $($args[1]) failed" }; $out }

function Get-SecurityGroup([string] $name, [string] $description) {
    $id = Invoke-Aws ec2 describe-security-groups @aws --filters "Name=vpc-id,Values=$vpc" "Name=group-name,Values=$name" --query 'SecurityGroups[0].GroupId' --output text
    if ($id -eq 'None' -or -not $id) {
        $spec = "ResourceType=security-group,Tags=[{Key=Name,Value=$name},{Key=Project,Value=AEContentPlatform},{Key=Environment,Value=dev},{Key=Owner,Value=AE Content Platform}]"
        $id = Invoke-Aws ec2 create-security-group @aws --vpc-id $vpc --group-name $name --description $description --tag-specifications $spec --query GroupId --output text
        "Created $name ($id)" | Write-Host
    }
    $id
}
function Grant-Ingress([string] $group, [string] $permission) {
    $out = & aws ec2 authorize-security-group-ingress @aws --group-id $group --ip-permissions $permission 2>&1
    if ($LASTEXITCODE -and ($out -join ' ') -notmatch 'InvalidPermission.Duplicate') { throw "Ingress rule failed on ${group}: $out" }
}

$albGroup = Get-SecurityGroup 'aecp-dev-library-alb-sg' 'AE Library dev ALB: HTTPS from approved ranges only'
$webGroup = Get-SecurityGroup 'aecp-dev-library-web-sg' 'AE Library dev app tasks: port 3000 from the library ALB only'
foreach ($cidr in $AllowedCidr) {
    foreach ($port in 443, 80) { Grant-Ingress $albGroup "IpProtocol=tcp,FromPort=$port,ToPort=$port,IpRanges=[{CidrIp=$cidr,Description=AE Library dev approved range}]" }
}
Grant-Ingress $webGroup "IpProtocol=tcp,FromPort=3000,ToPort=3000,UserIdGroupPairs=[{GroupId=$albGroup,Description=AE Library ALB}]"
Grant-Ingress $rdsSecurityGroup "IpProtocol=tcp,FromPort=5432,ToPort=5432,UserIdGroupPairs=[{GroupId=$webGroup,Description=AE Library app tasks}]"

$targetGroup = & aws elbv2 describe-target-groups @aws --names aecp-dev-library-tg --query 'TargetGroups[0].TargetGroupArn' --output text 2>$null
if ($LASTEXITCODE -or -not $targetGroup -or $targetGroup -eq 'None') {
    $targetGroup = Invoke-Aws elbv2 create-target-group @aws --name aecp-dev-library-tg --protocol HTTP --port 3000 --vpc-id $vpc --target-type ip `
        --health-check-protocol HTTP --health-check-path /health --matcher HttpCode=200 --health-check-interval-seconds 15 --healthy-threshold-count 2 --unhealthy-threshold-count 3 `
        --tags $tags --query 'TargetGroups[0].TargetGroupArn' --output text
}
Invoke-Aws elbv2 modify-target-group-attributes @aws --target-group-arn $targetGroup --attributes 'Key=deregistration_delay.timeout_seconds,Value=30' | Out-Null

$loadBalancer = & aws elbv2 describe-load-balancers @aws --names aecp-dev-library-alb --query 'LoadBalancers[0].LoadBalancerArn' --output text 2>$null
if ($LASTEXITCODE -or -not $loadBalancer -or $loadBalancer -eq 'None') {
    $loadBalancer = Invoke-Aws elbv2 create-load-balancer @aws --name aecp-dev-library-alb --type application --scheme internet-facing --ip-address-type ipv4 `
        --subnets $publicSubnets --security-groups $albGroup --tags $tags --query 'LoadBalancers[0].LoadBalancerArn' --output text
}
Invoke-Aws elbv2 modify-load-balancer-attributes @aws --load-balancer-arn $loadBalancer --attributes 'Key=routing.http.drop_invalid_header_fields.enabled,Value=true' | Out-Null

$listeners = Invoke-Aws elbv2 describe-listeners @aws --load-balancer-arn $loadBalancer --query 'Listeners[].Port' --output text
if ("$listeners" -notmatch '\b443\b') {
    Invoke-Aws elbv2 create-listener @aws --load-balancer-arn $loadBalancer --protocol HTTPS --port 443 --certificates CertificateArn=$certificate `
        --ssl-policy ELBSecurityPolicy-TLS13-1-2-2021-06 --default-actions "Type=forward,TargetGroupArn=$targetGroup" --tags $tags | Out-Null
}
if ("$listeners" -notmatch '\b80\b') {
    Invoke-Aws elbv2 create-listener @aws --load-balancer-arn $loadBalancer --protocol HTTP --port 80 `
        --default-actions 'Type=redirect,RedirectConfig={Protocol=HTTPS,Port=443,StatusCode=HTTP_301}' --tags $tags | Out-Null
}

Invoke-Aws elbv2 describe-load-balancers @aws --load-balancer-arns $loadBalancer --query 'LoadBalancers[0].{name:LoadBalancerName,dns:DNSName,state:State.Code,scheme:Scheme}' --output json
"ALB security group: $albGroup; app security group: $webGroup; target group: $targetGroup"
