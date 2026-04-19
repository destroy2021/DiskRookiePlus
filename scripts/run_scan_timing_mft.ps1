param(
  [string]$ScanPath = "D:\",
  [switch]$RunNormal
)

$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$targetDir = Join-Path $repoRoot "target"
$depsDir = Join-Path $targetDir "debug\deps"

function Remove-OldArtifacts {
  param(
    [string]$Pattern
  )

  if (-not (Test-Path $depsDir)) {
    return
  }

  $items = Get-ChildItem -Path $depsDir -Filter $Pattern -File -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending
  if ($items.Count -le 1) {
    return
  }

  $items | Select-Object -Skip 1 | Remove-Item -Force -ErrorAction SilentlyContinue
}

Write-Host "[scan-script] repo root: $repoRoot"
Write-Host "[scan-script] target dir: $targetDir"
Write-Host "[scan-script] scan path: $ScanPath"
Write-Host "[scan-script] run normal walk: $($RunNormal.IsPresent)"

$env:CARGO_TARGET_DIR = $targetDir
$env:CARGO_INCREMENTAL = "1"
$env:RUSTFLAGS = "-C debuginfo=0"
$env:SCAN_PATH = $ScanPath
$env:SCAN_NORMAL = if ($RunNormal.IsPresent) { "1" } else { "0" }

Push-Location $repoRoot
try {
  cargo test -p ai-disk-scanner --test scan_timing -- --exact scan_timing_mft_vs_normal --nocapture
  if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
  }
} finally {
  Pop-Location
}

Remove-OldArtifacts -Pattern "scan_timing-*.exe"
Remove-OldArtifacts -Pattern "scan_timing-*.pdb"
Remove-OldArtifacts -Pattern "scan_timing-*.d"

if (Test-Path $depsDir) {
  $scanArtifacts = Get-ChildItem -Path $depsDir -Filter "scan_timing-*" -File -ErrorAction SilentlyContinue
  $sizeMb = [math]::Round((($scanArtifacts | Measure-Object Length -Sum).Sum / 1MB), 2)
  Write-Host "[scan-script] kept scan_timing artifacts: $($scanArtifacts.Count), size: ${sizeMb}MB"
}
