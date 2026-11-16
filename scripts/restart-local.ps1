$ErrorActionPreference = 'Stop'
$projectDir = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Set-Location -LiteralPath $projectDir
$runDir = Join-Path $projectDir 'var\run'

function Invoke-ProjectNode {
    & node.exe @args
    if ($LASTEXITCODE -ne 0) { throw "Node exited with code $LASTEXITCODE." }
}

# npm dev/start may have been launched in a terminal without a service PID file.
function Stop-ManualProjectServers {
    $moduleDir = [regex]::Escape((Join-Path $projectDir 'node_modules\'))
    $nextEntry = $moduleDir + 'next\\dist\\(bin\\next(?=["\s]|$)|server\\lib\\start-server\.js(?=["\s]|$))'
    $workerEntry = $moduleDir + 'tsx\\dist\\cli\.mjs(?=["\s]|$)'
    $nodes = Get-CimInstance Win32_Process -Filter "Name='node.exe'"
    foreach ($process in $nodes) {
        $command = ([string]$process.CommandLine).Replace('/', '\') -replace '\\+','\' -replace '\\\.bin\\\.\.\\','\'
        $manualWeb = $command -match $nextEntry -and ($command -match '\s(dev|start)(\s|$)' -or $command -match '\\start-server\.js')
        $manualWorker = $command -match $workerEntry -and $command -match 'scripts\\worker\.ts(?=["\s]|$)'
        if (!$manualWeb -and !$manualWorker) { continue }
        $live = Get-CimInstance Win32_Process -Filter "ProcessId=$($process.ProcessId)"
        if (!$live -or $live.CreationDate -ne $process.CreationDate) { continue }
        Write-Host "Stopping project process $($live.ProcessId)..."
        & taskkill.exe /PID $live.ProcessId /T /F | Out-Null
        if ($LASTEXITCODE -ne 0 -and (Get-Process -Id $live.ProcessId -ErrorAction SilentlyContinue)) {
            throw "Could not stop project process $($live.ProcessId)."
        }
    }
}

function Wait-ForShop {
    $deadline = [DateTime]::UtcNow.AddSeconds(60)
    $shopProcess = Get-Process -Id ([int](Get-Content -LiteralPath (Join-Path $runDir 'shop.pid')))
    $workerProcess = Get-Process -Id ([int](Get-Content -LiteralPath (Join-Path $runDir 'worker.pid')))
    do {
        if ($shopProcess.HasExited -or $workerProcess.HasExited) {
            throw 'A service exited. Check var\run\shop.error.log and var\run\worker.error.log.'
        }
        try {
            $health = Invoke-RestMethod -Uri 'http://localhost:3000/api/health' -TimeoutSec 3
            $admin = Invoke-WebRequest -UseBasicParsing -Uri 'http://localhost:3000/admin' -TimeoutSec 3
            $finalUri = $admin.BaseResponse.ResponseUri
            if (!$finalUri) { $finalUri = $admin.BaseResponse.RequestMessage.RequestUri }
            $workerReady = Select-String -LiteralPath (Join-Path $runDir 'worker.log') -Pattern 'Europe/Sofia' -SimpleMatch -Quiet
            if ($health.database -eq 'ok' -and $admin.StatusCode -eq 200 -and $finalUri.AbsolutePath -eq '/admin/login' -and $workerReady) { return }
        } catch {
            # The HTTP listener and worker can take a moment to become ready.
        }
        Start-Sleep -Milliseconds 500
    } while ([DateTime]::UtcNow -lt $deadline)
    throw 'Startup timed out. Check the logs in var\run.'
}

$lock = $null
$startingServices = $false
try {
    New-Item -ItemType Directory -Force -Path $runDir | Out-Null
    try {
        $lock = [IO.File]::Open((Join-Path $runDir 'restart.lock'), 'OpenOrCreate', 'ReadWrite', 'None')
    } catch [IO.IOException] {
        throw 'Another restart is already in progress.'
    }
    Write-Host 'Stopping the local shop, demo and background workers...'
    foreach ($service in 'demo', 'shop', 'demo-worker', 'worker') {
        & "$PSScriptRoot\stop-local.ps1" -Mode $service
    }
    Stop-ManualProjectServers
    $listener = [Net.NetworkInformation.IPGlobalProperties]::GetIPGlobalProperties().GetActiveTcpListeners() |
        Where-Object Port -eq 3000
    if ($listener) { throw 'Port 3000 is occupied by another process. Free the port and run restart.bat again.' }

    Write-Host 'Restarting the project database...'
    Invoke-ProjectNode scripts/postgres.mjs stop
    Invoke-ProjectNode scripts/postgres.mjs start
    Invoke-ProjectNode --env-file=.env.local --import tsx scripts/migrate.ts
    if (!(Test-Path -LiteralPath '.next\BUILD_ID')) {
        Write-Host 'Building the shop for its first start...'
        Invoke-ProjectNode node_modules/next/dist/bin/next build --webpack
    }

    $startingServices = $true
    & "$PSScriptRoot\start-local.ps1" -Mode shop
    & "$PSScriptRoot\start-local.ps1" -Mode worker
    Wait-ForShop
    Write-Host 'Shop:  http://localhost:3000'
    Write-Host 'Admin: http://localhost:3000/admin'
} catch {
    $failure = $_.Exception.Message
    if ($startingServices) {
        foreach ($service in 'shop', 'worker') {
            try { & "$PSScriptRoot\stop-local.ps1" -Mode $service } catch { Write-Warning $_ }
        }
    }
    [Console]::Error.WriteLine($failure)
    exit 1
} finally {
    if ($lock) { $lock.Dispose() }
}
