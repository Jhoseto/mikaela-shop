param([ValidateSet('shop','demo','worker','demo-worker')][string]$Mode='shop')
$ErrorActionPreference='Stop'
$projectDir=(Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$pidFile=Join-Path $projectDir "var/run/$Mode.pid"
if(!(Test-Path -LiteralPath $pidFile)){return}
$entry=Get-Item -LiteralPath $pidFile
$instance=Get-Process -Id ([int](Get-Content -LiteralPath $pidFile)) -ErrorAction SilentlyContinue
if($instance -and $instance.ProcessName -eq 'node' -and $instance.StartTime.ToUniversalTime() -le $entry.LastWriteTimeUtc.AddSeconds(1)){
 $cmd=(Get-CimInstance Win32_Process -Filter "ProcessId=$($instance.Id)").CommandLine
 $flag=if($Mode -like 'demo*'){'--env-file=.env.demo.local'}else{'--env-file=.env.local'}
 $expected=if($Mode -like '*worker'){'scripts/worker.ts'}else{'node_modules/next/dist/bin/next'}
 if($cmd -and $cmd.Contains($flag) -and $cmd.Contains($expected)){
  & taskkill.exe /PID $instance.Id /T /F | Out-Null
  if(!$instance.WaitForExit(12000)){throw "Timed out stopping $Mode."}
 }
}
Remove-Item -LiteralPath $pidFile -Force
Write-Output "Stopped $Mode"

