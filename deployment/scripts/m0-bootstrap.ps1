param([switch]$TrustCertificate)
$ErrorActionPreference='Stop'
$deploymentRoot=Split-Path $PSScriptRoot -Parent
$repositoryRoot=Split-Path $deploymentRoot -Parent
$localRoot=Join-Path $deploymentRoot '.local'
if(-not(Test-Path -LiteralPath (Join-Path $localRoot 'preservation-baseline.json'))){& "$PSScriptRoot/m0-preservation.ps1" -Capture}
& "$PSScriptRoot/m0-runtime.ps1" -Action start
if($TrustCertificate){& dotnet dev-certs https --trust;if($LASTEXITCODE -ne 0){throw 'Certificate trust failed.'}}
$deadline=(Get-Date).AddMinutes(5)
$apiKey=$null
while((Get-Date) -lt $deadline){
  $candidate=(& docker exec timeline-m0-sql-1 bash -c '/opt/mssql-tools18/bin/sqlcmd -S localhost -U sa -P "$MSSQL_SA_PASSWORD" -C -d timeline_m0 -h -1 -W -Q "SET NOCOUNT ON; SELECT TOP 1 Value FROM AccessTokens WHERE UserId=1 AND Feature=CHAR(97)+CHAR(112)+CHAR(105)+CHAR(107)+CHAR(101)+CHAR(121)"' 2>$null | Out-String).Trim()
  if($LASTEXITCODE -eq 0 -and $candidate -match '^[A-Za-z0-9_-]{32,256}$'){$apiKey=$candidate;break}
  Start-Sleep -Seconds 2
}
if(-not $apiKey){throw 'Isolated M0 repository did not initialize its local admin key in five minutes.'}
$accountsPath=Join-Path $localRoot 'accounts.json'
$accounts=if(Test-Path -LiteralPath $accountsPath){Get-Content -LiteralPath $accountsPath -Raw | ConvertFrom-Json -AsHashtable}else{@{}}
if(-not $accounts.ContainsKey('admin')){$accounts.admin=@{}}
$accounts.admin.apiKey=$apiKey
$accounts | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $accountsPath -Encoding utf8
Push-Location $repositoryRoot
try {
  & node scripts/m0-local-api.cjs
  if($LASTEXITCODE -ne 0){throw 'Local repository readiness failed.'}
  & node scripts/m0-provision.cjs
  if($LASTEXITCODE -ne 0){throw 'Local provisioning failed.'}
  & node scripts/m0-security-setup.cjs
  if($LASTEXITCODE -ne 0){throw 'Local timeline security setup failed.'}
} finally {Pop-Location}
& "$PSScriptRoot/m0-preservation.ps1"
