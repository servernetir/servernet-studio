# SPDX-License-Identifier: AGPL-3.0-only
# Disposable Windows CI only. No account sign-in or model requests are made.
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if ($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_OS -ne 'Windows') {
    throw 'Installer smoke requires a disposable Windows GitHub runner.'
}
$root = Join-Path $env:RUNNER_TEMP ('servernet-studio-install-' + [guid]::NewGuid().ToString('N'))
$installPath = Join-Path $root 'app'
$reportPath = Join-Path $PWD 'release/windows-install-smoke.json'
$signed = $env:SERVERNET_SIGNED_BUILD -eq 'true'
$report = [ordered]@{
    source_sha = $env:GITHUB_SHA
    runner_os = $env:RUNNER_OS
    checked_at = [DateTime]::UtcNow.ToString('o')
    signed_build = $signed
    checks = [ordered]@{ install = $false; installed_launch = $false; uninstall = $false }
    live_account_and_billing_tested = $false
}
$appProcess = $null
function Run-Installer([string]$File, [string]$Arguments) {
    $process = Start-Process -FilePath $File -ArgumentList $Arguments -PassThru
    if (-not $process.WaitForExit(120000)) {
        Stop-Process -Id $process.Id -ErrorAction SilentlyContinue
        throw 'Installer process timed out.'
    }
    if ($process.ExitCode -ne 0) { throw "Installer failed with exit code $($process.ExitCode)." }
}
try {
    $version = (Get-Content package.json -Raw | ConvertFrom-Json).version
    $prefix = if ($signed) { 'ServerNet-Studio' } else { 'ServerNet-Studio-UNSIGNED-TEST' }
    $installer = Join-Path $PWD "release/$prefix-$version-win-x64.exe"
    if (-not (Test-Path -LiteralPath $installer -PathType Leaf)) { throw 'Expected NSIS installer is missing.' }
    $report.installer_sha256 = (Get-FileHash -LiteralPath $installer -Algorithm SHA256).Hash.ToLowerInvariant()
    New-Item -Path $root -ItemType Directory | Out-Null
    # NSIS requires /D last and unquoted; the rest of the argument is its path.
    Run-Installer $installer "/S /D=$installPath"
    $binary = Join-Path $installPath 'ServerNet Studio.exe'
    $uninstaller = Join-Path $installPath 'Uninstall ServerNet Studio.exe'
    if (-not (Test-Path -LiteralPath $binary -PathType Leaf) -or
        -not (Test-Path -LiteralPath $uninstaller -PathType Leaf)) { throw 'Installed application or uninstaller is missing.' }
    if ($signed) {
        foreach ($file in @($binary, $uninstaller)) {
            $signature = Get-AuthenticodeSignature -LiteralPath $file
            if ($signature.Status -ne 'Valid') { throw 'Invalid installed executable signature.' }
            if ([string]::IsNullOrWhiteSpace($env:SERVERNET_WINDOWS_PUBLISHER)) { throw 'Missing publisher identity.' }
            $subject = $signature.SignerCertificate.Subject
            $publisher = [regex]::Escape($env:SERVERNET_WINDOWS_PUBLISHER)
            if ($subject -notmatch "(^|,\s*)CN=$publisher(,|$)") { throw 'Unexpected installed signing identity.' }
        }
    }
    $report.checks.install = $true
    $appProcess = Start-Process -FilePath $binary -PassThru
    if ($appProcess.WaitForExit(8000)) { throw 'Installed client exited before startup completed.' }
    $report.checks.installed_launch = $true
    Stop-Process -Id $appProcess.Id
    $appProcess.WaitForExit()
    $appProcess = $null
    Run-Installer $uninstaller '/S'
    $deadline = [DateTime]::UtcNow.AddSeconds(60)
    while ((Test-Path -LiteralPath $binary) -and [DateTime]::UtcNow -lt $deadline) { Start-Sleep -Milliseconds 500 }
    if (Test-Path -LiteralPath $binary) { throw 'Uninstaller left the installed executable behind.' }
    $report.checks.uninstall = $true
    Write-Output 'NSIS install, installed application startup and uninstall passed. Live sign-in and billing remain separate.'
} finally {
    if ($null -ne $appProcess -and -not $appProcess.HasExited) {
        Stop-Process -Id $appProcess.Id -ErrorAction SilentlyContinue
    }
    $report | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $reportPath -Encoding utf8
}
