<#
.SYNOPSIS
  Sets up River Host on this PC: your River server and its public tunnel start
  every time you sign in to Windows, run hidden in the background, and restart
  themselves if they stop. Your community's data lives in a permanent folder.

.DESCRIPTION
  - Copies the host runner to $HostDir.
  - Writes $HostDir\host.json (only if it does not exist yet).
  - Registers the "River Host" task in Task Scheduler (at sign-in, no admin rights needed).
  - Starts it now.

  The server itself runs from $HostDir\app: a copy of River at a release tag
  (create it with: git worktree add --detach "$HostDir\app" vX.Y.Z, then npm ci
  in it). Data stays in $HostDir\data across updates and restarts.

  Remove with: Unregister-ScheduledTask -TaskName "River Host" -Confirm:$false
#>
param(
  [string]$HostDir = (Join-Path $env:USERPROFILE 'RiverHost'),
  [int]$Port = 8790
)
$ErrorActionPreference = 'Stop'

$node = (Get-Command node -ErrorAction Stop).Source
New-Item -ItemType Directory -Force $HostDir | Out-Null
Copy-Item (Join-Path $PSScriptRoot 'river-host.ts') $HostDir -Force

$config = Join-Path $HostDir 'host.json'
if (-not (Test-Path $config)) {
  @{
    appDir = (Join-Path $HostDir 'app')
    dataDir = (Join-Path $HostDir 'data')
    port = $Port
    cloudflared = 'C:\Program Files (x86)\cloudflared\cloudflared.exe'
    env = @{ RIVER_RATE_LIMIT_PER_MINUTE = '5000' }
  } | ConvertTo-Json | ForEach-Object { [IO.File]::WriteAllText($config, $_) }  # no byte-order mark
}

# A tiny launcher so Node runs without a console window.
$launcher = Join-Path $HostDir 'river-host.vbs'
$runner = Join-Path $HostDir 'river-host.ts'
@"
Set shell = CreateObject("WScript.Shell")
shell.CurrentDirectory = "$HostDir"
shell.Run """$node"" ""$runner"" ""$config""", 0, False
"@ | Set-Content -Encoding ascii $launcher

$action = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument "`"$launcher`""
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 10 -RestartInterval (New-TimeSpan -Minutes 1) -StartWhenAvailable
Register-ScheduledTask -TaskName 'River Host' -Action $action -Trigger $trigger -Settings $settings `
  -Description 'Keeps your River server and its public address running. Installed by River.' -Force | Out-Null

# Replace a River Host that is already running (started by hand or by an older install).
Get-CimInstance Win32_Process |
  Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -like '*river-host.ts*' } |
  ForEach-Object {
    Get-CimInstance Win32_Process -Filter "ParentProcessId=$($_.ProcessId)" |
      ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
    Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
  }
Start-Sleep -Seconds 2

Start-ScheduledTask -TaskName 'River Host'
Write-Output "River Host installed in $HostDir and started. It will start again every time you sign in."
Write-Output "Status: $HostDir\status.json   Logs: $HostDir\logs"
