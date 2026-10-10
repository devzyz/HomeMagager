param(
    [ValidateSet('Start', 'Stop')][string]$Action = 'Start',
    [string]$HostName,
    [int]$SshPort,
    [int]$LocalPort = 13000,
    [int]$RemotePort = 3000,
    [string]$PasswordFile = "$env:USERPROFILE\.ssh\autodl-psw.env"
)
$ErrorActionPreference = 'Stop'
$taskRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$taskState = Join-Path $taskRoot 'artifacts/autodl'
New-Item -ItemType Directory -Force -Path $taskState | Out-Null
$taskPidFile = Join-Path $taskState 'tunnel.pid'
$taskScript = Join-Path $PSScriptRoot 'autodl.py'
$taskExisting = $null
if (Test-Path -LiteralPath $taskPidFile) {
    $taskProcessId = [int](Get-Content -LiteralPath $taskPidFile)
    $taskCandidate = Get-CimInstance Win32_Process -Filter "ProcessId=$taskProcessId" -ErrorAction SilentlyContinue
    if ($taskCandidate -and $taskCandidate.CommandLine.Contains($taskScript) -and $taskCandidate.CommandLine.Contains('tunnel')) {
        $taskExisting = $taskCandidate
    }
}
if ($Action -eq 'Stop') {
    if ($taskExisting) { Stop-Process -Id $taskExisting.ProcessId }
    Remove-Item -LiteralPath $taskPidFile -ErrorAction SilentlyContinue
    Write-Output 'AutoDL local SSH tunnel stopped.'
    exit 0
}
if ($taskExisting) {
    $taskHealth = Invoke-RestMethod -Uri "http://127.0.0.1:$LocalPort/api/health" -TimeoutSec 5
    if ($taskHealth.status -ne 'ok') { throw 'Existing tunnel health check failed.' }
    Write-Output "Tunnel already running: http://127.0.0.1:$LocalPort"
    exit 0
}
if (Get-NetTCPConnection -State Listen -LocalPort $LocalPort -ErrorAction SilentlyContinue) {
    throw "Local port $LocalPort is in use. Choose another port and update the remote BASE_URL."
}
if (-not $HostName -or $HostName -notmatch '^[A-Za-z0-9.-]+$' -or $SshPort -lt 1 -or $SshPort -gt 65535) { throw 'Start requires valid -HostName and -SshPort.' }
$taskPython = (Get-Command python -ErrorAction Stop).Source
$taskArgs = @('-u', ('"' + $taskScript + '"'), '--host', $HostName, '--port', "$SshPort", '--password-file', ('"' + $PasswordFile + '"'), 'tunnel', '--local-port', "$LocalPort", '--remote-port', "$RemotePort")
$taskProcess = Start-Process -FilePath $taskPython -ArgumentList $taskArgs -WorkingDirectory $taskRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $taskState 'tunnel.log') -RedirectStandardError (Join-Path $taskState 'tunnel-error.log')
Set-Content -LiteralPath $taskPidFile -Value $taskProcess.Id
for ($taskAttempt = 0; $taskAttempt -lt 30; $taskAttempt++) {
    if ($taskProcess.HasExited) { throw 'Tunnel process exited; inspect artifacts/autodl/tunnel-error.log.' }
    try {
        $taskHealth = Invoke-RestMethod -Uri "http://127.0.0.1:$LocalPort/api/health" -TimeoutSec 2
        if ($taskHealth.status -eq 'ok') {
            Write-Output "Tunnel running (PID $($taskProcess.Id)): http://127.0.0.1:$LocalPort"
            exit 0
        }
    } catch {
        Start-Sleep -Milliseconds 500
    }
}
Stop-Process -Id $taskProcess.Id -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $taskPidFile -ErrorAction SilentlyContinue
throw 'Tunnel did not become healthy; inspect the local tunnel and remote service logs.'