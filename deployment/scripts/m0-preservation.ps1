param([switch]$Capture)
$ErrorActionPreference='Stop'
$repositoryRoot=Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$baselinePath=Join-Path $repositoryRoot 'deployment/.local/preservation-baseline.json'
if($Capture) {
  if(Test-Path -LiteralPath $baselinePath) { throw 'Preservation baseline already exists; refusing to replace it.' }
  New-Item -ItemType Directory -Force -Path (Split-Path $baselinePath -Parent) | Out-Null
  $preservedPaths=@('deployment/dbvolume','deployment/temp/certificates','.env','client/.env','client/.env.local')
  $items=foreach($relativePath in $preservedPaths){$candidate=Join-Path $repositoryRoot $relativePath;if(Test-Path -LiteralPath $candidate){$item=Get-Item -LiteralPath $candidate;if($item.PSIsContainer){Get-ChildItem -LiteralPath $candidate -File -Recurse}else{$item}}}
  @($items | ForEach-Object{[pscustomobject]@{path=$_.FullName;length=$_.Length;sha256=(Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash}}) | ConvertTo-Json | Set-Content -LiteralPath $baselinePath
  Write-Output 'Preservation hashes captured. Existing database, certificates and environment files are not used by M0.'
} else {
  if(-not(Test-Path -LiteralPath $baselinePath)){throw 'Preservation baseline missing.'}
  $baseline=Get-Content -LiteralPath $baselinePath -Raw | ConvertFrom-Json
  $changed=@($baseline | Where-Object{ -not(Test-Path -LiteralPath $_.path) -or (Get-FileHash -LiteralPath $_.path -Algorithm SHA256).Hash -ne $_.sha256 })
  if($changed.Count){throw "Preserved file hashes changed: $($changed.Count). Inspect the ignored baseline locally."}
  Write-Output "Preservation verified: $($baseline.Count) files unchanged."
}
