# Download official Windows PostgreSQL binaries into this project.
$ErrorActionPreference='Stop'
$projectDir=(Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$runtime=Join-Path $projectDir 'var/pg-runtime'
$archive=Join-Path $projectDir 'var/postgresql-18.7.zip'
New-Item -ItemType Directory -Force $runtime | Out-Null
if(!(Test-Path $archive)){Invoke-WebRequest -Uri 'https://get.enterprisedb.com/postgresql/postgresql-18.7-1-windows-x64-binaries.zip' -OutFile $archive}
if(!(Test-Path (Join-Path $runtime 'pgsql/bin/pg_dump.exe'))){Expand-Archive -LiteralPath $archive -DestinationPath $runtime}
Write-Output 'PostgreSQL 18.7 is ready for npm run db:start'

