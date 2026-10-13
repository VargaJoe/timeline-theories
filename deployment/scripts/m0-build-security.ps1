param([switch]$Force)
$ErrorActionPreference='Stop'
$deploymentRoot=Split-Path $PSScriptRoot -Parent
$sourceRoot=Join-Path $deploymentRoot 'extensions/m0-timeline-security'
$project=Join-Path $sourceRoot 'Timeline.Theories.M0.Security.csproj'
$localRoot=Join-Path $deploymentRoot '.local'
$buildRoot=Join-Path $localRoot 'build/timeline-security'
$outputRoot=Join-Path $localRoot 'extensions'
$manifestPath=Join-Path $localRoot 'security-extension-build.json'
$assemblyPath=Join-Path $outputRoot 'Timeline.Theories.M0.Security.dll'
$inputs=@(Get-ChildItem -LiteralPath $sourceRoot -File | Sort-Object Name | ForEach-Object {[ordered]@{name=$_.Name;sha256=(Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash}})
$inputJson=$inputs | ConvertTo-Json -Compress
if(-not $Force -and (Test-Path -LiteralPath $manifestPath) -and (Test-Path -LiteralPath $assemblyPath)){
  $existing=Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
  if($existing.inputJson -eq $inputJson -and $existing.assemblySha256 -eq (Get-FileHash -LiteralPath $assemblyPath -Algorithm SHA256).Hash){Write-Output 'M0 timeline security extension is current.';return}
}
New-Item -ItemType Directory -Force -Path $buildRoot,$outputRoot | Out-Null
$buildEnvironment=@{DOTNET_CLI_HOME=(Join-Path $buildRoot 'dotnet-home');DOTNET_CLI_TELEMETRY_OPTOUT='1';DOTNET_GENERATE_ASPNET_CERTIFICATE='false';DOTNET_ADD_GLOBAL_TOOLS_TO_PATH='false';DOTNET_SKIP_FIRST_TIME_EXPERIENCE='true';DOTNET_NOLOGO='true';NUGET_HTTP_CACHE_PATH=(Join-Path $buildRoot 'nuget-http-cache');NUGET_PLUGINS_CACHE_PATH=(Join-Path $buildRoot 'nuget-plugins-cache')}
$originalEnvironment=@{}
foreach($name in $buildEnvironment.Keys){$originalEnvironment[$name]=[Environment]::GetEnvironmentVariable($name,'Process');[Environment]::SetEnvironmentVariable($name,$buildEnvironment[$name],'Process')}
try {
  $objRoot=(Join-Path $buildRoot 'obj')+[IO.Path]::DirectorySeparatorChar
  $packagesRoot=Join-Path $localRoot 'build/packages'
  & dotnet build $project --configuration Release --output $outputRoot --nologo --verbosity minimal "-p:BaseIntermediateOutputPath=$objRoot" "-p:MSBuildProjectExtensionsPath=$objRoot" "-p:RestorePackagesPath=$packagesRoot" '-p:RestoreSources=https://api.nuget.org/v3/index.json'
  if($LASTEXITCODE -ne 0){throw 'Local timeline security extension build failed.'}
} finally {foreach($name in $originalEnvironment.Keys){[Environment]::SetEnvironmentVariable($name,$originalEnvironment[$name],'Process')}}
if(-not(Test-Path -LiteralPath $assemblyPath)){throw 'Security extension assembly was not produced.'}
@{version=1;builtAt=(Get-Date).ToUniversalTime().ToString('o');inputJson=$inputJson;assemblySha256=(Get-FileHash -LiteralPath $assemblyPath -Algorithm SHA256).Hash;policy='Only owned .local build outputs/packages. Runtime assembly is mounted read-only.'} | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $manifestPath -Encoding utf8
Write-Output 'M0 timeline security extension built.'
