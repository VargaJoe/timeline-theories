Param (
	[Parameter(Mandatory=$False)]
	[switch]$UseVolume,
	[Parameter(Mandatory=$False)]
	[string]$VolumeBasePath="./volumes",
	[Parameter(Mandatory=$False)]
	[switch]$DryRun
)

# Legacy certificate helper only; M0 uses scripts/m0-bootstrap.ps1.
$CertPsw=[Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(36))

# create dev cert if cert is not available
& $PSScriptRoot/scripts/create-devcert.ps1 `
	-VolumeBasePath $VolumeBasePath `
	-CertPsw $CertPsw `
	-UseVolume $UseVolume `
	-DryRun $DryRun `
	-ErrorAction stop

