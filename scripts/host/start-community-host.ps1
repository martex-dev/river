# Starts a River server on this PC plus a free Cloudflare tunnel, each in its
# own window, and prints the public server address.
#   powershell -ExecutionPolicy Bypass -File scripts\host\start-community-host.ps1 [-Port 8790]
param([int]$Port = 8790)

$river = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$dataDir = Join-Path $river 'apps\server\data'
New-Item -ItemType Directory -Force $dataDir | Out-Null

$listening = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
if (-not $listening) {
  $serverCmd = "`$host.UI.RawUI.WindowTitle='River server (keep open)'; cd '$river'; `$env:RIVER_PORT='$Port'; `$env:RIVER_TRUST_PROXY='true'; `$env:RIVER_RATE_LIMIT_PER_MINUTE='5000'; npm run server"
  Start-Process powershell -ArgumentList '-NoExit', '-Command', $serverCmd -WindowStyle Minimized
  Write-Host "Started River server on port $Port"
} else {
  Write-Host "Something is already listening on port $Port (assuming it is the River server)"
}

$cloudflared = (Get-Command cloudflared -ErrorAction SilentlyContinue).Source
if (-not $cloudflared) { $cloudflared = 'C:\Program Files (x86)\cloudflared\cloudflared.exe' }
if (-not (Test-Path $cloudflared)) { throw 'cloudflared not found. Install it: winget install --id Cloudflare.cloudflared' }

$tunnelLog = Join-Path $dataDir ('tunnel-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.log')
# http2 is more stable than the default QUIC on some home networks.
$tunnelCmd = "`$host.UI.RawUI.WindowTitle='River tunnel (keep open)'; & '$cloudflared' tunnel --protocol http2 --url http://localhost:$Port --logfile '$tunnelLog'"
Start-Process powershell -ArgumentList '-NoExit', '-Command', $tunnelCmd -WindowStyle Minimized

$url = $null
for ($i = 0; $i -lt 45 -and -not $url; $i++) {
  Start-Sleep -Seconds 2
  if (Test-Path $tunnelLog) {
    $m = Select-String -Path $tunnelLog -Pattern 'https://[a-z0-9-]+\.trycloudflare\.com' | Select-Object -First 1
    if ($m) { $url = $m.Matches[0].Value }
  }
}
if (-not $url) { throw "The tunnel did not report an address. See $tunnelLog" }
Write-Host ''
Write-Host "River server address: $url" -ForegroundColor Green
Write-Host 'Keep both minimized windows open. If the tunnel restarts, this address changes.'
