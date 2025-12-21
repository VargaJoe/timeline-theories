Param (
	[Parameter(Mandatory=$False)]
	[switch]$UseVolume,
	[Parameter(Mandatory=$False)]
	[string]$VolumeBasePath="./volumes",
	[Parameter(Mandatory=$False)]
	[switch]$DryRun
)

# Developer certificate demo passwords
$CertPsw="SuP3rS3CuR3P4sSw0Rd"

# create dev cert if cert is not available
& $PSScriptRoot/scripts/create-devcert.ps1 `
	-VolumeBasePath $VolumeBasePath `
	-CertPsw $CertPsw `
	-UseVolume $UseVolume `
	-DryRun $DryRun `
	-ErrorAction stop

