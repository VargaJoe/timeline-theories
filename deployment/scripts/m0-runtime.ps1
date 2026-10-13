param([ValidateSet('start','stop','restart','status')][string]$Action = 'start')
$ErrorActionPreference = 'Stop'
$deploymentRoot = Split-Path $PSScriptRoot -Parent
$localRoot = Join-Path $deploymentRoot '.local'
$envPath = Join-Path $localRoot 'runtime.env'
if($Action -eq 'start'){& "$PSScriptRoot/m0-build-security.ps1"}
function New-LocalSecret { ([Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(36))).Replace('+','A').Replace('/','B') }
if (-not (Test-Path -LiteralPath $envPath)) {
  if ($Action -ne 'start') { throw 'No owned M0 runtime has been initialized.' }
  New-Item -ItemType Directory -Force -Path (Join-Path $localRoot 'certificates') | Out-Null
  $sqlPassword = 'M0a!' + (New-LocalSecret)
  $certPassword = New-LocalSecret
  $healthKey = New-LocalSecret
  @("M0_SQL_PASSWORD=$sqlPassword", "M0_CERT_PASSWORD=$certPassword", "M0_HEALTH_APIKEY=$healthKey") | Set-Content -LiteralPath $envPath -Encoding utf8
  # Export only the existing development certificate; never clean certificate stores.
  & dotnet dev-certs https --export-path (Join-Path $localRoot 'certificates/localhost.pfx') --password $certPassword | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Certificate export failed.' }
  & dotnet dev-certs https --export-path (Join-Path $localRoot 'certificates/localhost.pem') --format PEM --no-password | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Public certificate export failed.' }
  Copy-Item -LiteralPath (Join-Path $localRoot 'certificates/localhost.pem') -Destination (Join-Path $localRoot 'certificates/localhost.crt')
}
$composeArgs = @('compose','--project-name','timeline-m0','--env-file',$envPath,'--file',(Join-Path $deploymentRoot 'docker-compose.yml'))
switch ($Action) {
  'start' { & docker @composeArgs up -d }
  'stop' { & docker @composeArgs stop }
  'restart' { & "$PSScriptRoot/m0-build-security.ps1"; & docker @composeArgs restart repository identity }
  'status' { & docker @composeArgs ps }
}
if ($LASTEXITCODE -ne 0) { throw 'M0 Docker operation failed. Local secrets are never printed by this script.' }
