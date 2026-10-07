[CmdletBinding()]
param([string]$Component='*',[switch]$Plan,[switch]$NoLaunchPrompt,[string]$NativeScript,[string]$PackageRelative,[string]$Script,[string[]]$NativeArguments)
& 'C:\github\ProjectLaunchers\workspace-tools/Build.ps1' -Project 'grudgegit/grudge-studio-backend' -Component $Component -Plan:$Plan -NoLaunchPrompt:$NoLaunchPrompt -NativeScript $NativeScript -PackageRelative $PackageRelative -Script $Script -NativeArguments $NativeArguments
