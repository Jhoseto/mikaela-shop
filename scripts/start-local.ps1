param([ValidateSet('shop','demo','worker','demo-worker')][string]$Mode='shop')
$ErrorActionPreference='Stop'
$projectDir=(Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$nodePath=(Get-Command node.exe).Source
$runDir=Join-Path $projectDir 'var/run'
New-Item -Type Directory -Force $runDir | Out-Null
$demoMode=$Mode -like 'demo*'
$envFile=if($demoMode){'.env.demo.local'}else{'.env.local'}
$port=if($demoMode){3100}else{3000}
if($Mode -like '*worker'){$params=@("--env-file=$envFile",'--import','tsx','scripts/worker.ts')}else{$params=@("--env-file=$envFile",'node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port',[string]$port)}
$pidFile=Join-Path $runDir "$Mode.pid"
if(Test-Path $pidFile){$previous=Get-Process -Id ([int](Get-Content $pidFile)) -ErrorAction SilentlyContinue;if($previous -and $previous.ProcessName -eq 'node'){Write-Output "Already running: $Mode";return}}
$process=Start-Process -FilePath $nodePath -ArgumentList $params -WindowStyle Hidden -WorkingDirectory $projectDir -RedirectStandardOutput (Join-Path $runDir "$Mode.log") -RedirectStandardError (Join-Path $runDir "$Mode.error.log") -PassThru
$process.Id | Set-Content $pidFile
Write-Output "Started $Mode (PID $($process.Id))"

