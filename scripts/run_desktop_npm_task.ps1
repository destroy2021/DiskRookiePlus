param(
  [ValidateSet("postinstall", "dev", "dev:fast", "build", "build:exe", "frontend:dev", "frontend:build", "scan:timing:mft", "scan:timing:mft:normal")]
  [string]$Task,
  [switch]$AggressiveCleanup
)

$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$desktopDir = Join-Path $repoRoot "apps\desktop"
$targetDir = Join-Path $repoRoot "target"
$debugDir = Join-Path $targetDir "debug"
$depsDir = Join-Path $debugDir "deps"
$incrementalDir = Join-Path $debugDir "incremental"
$buildDir = Join-Path $debugDir "build"

function Get-EnvInt {
  param(
    [Parameter(Mandatory = $true)][string]$Name,
    [Parameter(Mandatory = $true)][int]$Default,
    [Parameter(Mandatory = $true)][int]$Min,
    [Parameter(Mandatory = $true)][int]$Max
  )
  $raw = [Environment]::GetEnvironmentVariable($Name)
  if ([string]::IsNullOrWhiteSpace($raw)) {
    return $Default
  }
  $parsed = 0
  if (-not [int]::TryParse($raw, [ref]$parsed)) {
    return $Default
  }
  if ($parsed -lt $Min) {
    return $Min
  }
  if ($parsed -gt $Max) {
    return $Max
  }
  return $parsed
}

function Get-EnvBool {
  param(
    [Parameter(Mandatory = $true)][string]$Name
  )
  $raw = [Environment]::GetEnvironmentVariable($Name)
  if ([string]::IsNullOrWhiteSpace($raw)) {
    return $false
  }
  return @("1", "true", "yes", "on") -contains $raw.Trim().ToLowerInvariant()
}

$staleDays = Get-EnvInt -Name "DISKROOKIE_TARGET_OPT_DAYS" -Default 7 -Min 1 -Max 90
$maxDebugMb = Get-EnvInt -Name "DISKROOKIE_TARGET_OPT_MAX_MB" -Default 4096 -Min 512 -Max 200000
$keepHashesNormal = Get-EnvInt -Name "DISKROOKIE_TARGET_OPT_KEEP_HASHES" -Default 2 -Min 1 -Max 10
$keepHashesAggressive = Get-EnvInt -Name "DISKROOKIE_TARGET_OPT_KEEP_HASHES_AGGRESSIVE" -Default 1 -Min 1 -Max 5
$keepIncrementalAggressive = Get-EnvInt -Name "DISKROOKIE_TARGET_OPT_KEEP_INCREMENTAL" -Default 1 -Min 0 -Max 10
$envAggressiveCleanup = Get-EnvBool -Name "DISKROOKIE_TARGET_OPT_AGGRESSIVE"
$cutoff = (Get-Date).AddDays(-$staleDays)

function Get-DirSizeBytes {
  param([string]$Path)
  if (-not (Test-Path $Path)) {
    return 0
  }
  $bytes = (Get-ChildItem -Path $Path -Recurse -File -ErrorAction SilentlyContinue | Measure-Object Length -Sum).Sum
  if ($null -eq $bytes) {
    return 0
  }
  return [int64]$bytes
}

function Get-DirSizeMb {
  param([string]$Path)
  return [math]::Round((Get-DirSizeBytes -Path $Path) / 1MB, 2)
}

function Remove-IncrementalDirs {
  param([switch]$Aggressive)

  if (-not (Test-Path $incrementalDir)) {
    return @{ RemovedDirs = 0; ReclaimedMb = 0 }
  }

  $allDirs = Get-ChildItem -Path $incrementalDir -Directory -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending
  if ($allDirs.Count -eq 0) {
    return @{ RemovedDirs = 0; ReclaimedMb = 0 }
  }

  $toRemove = @()
  if ($Aggressive) {
    $toRemove = $allDirs | Select-Object -Skip $keepIncrementalAggressive
  } else {
    $toRemove = $allDirs | Where-Object { $_.LastWriteTime -lt $cutoff }
  }

  $removed = 0
  $reclaimedBytes = 0
  foreach ($d in $toRemove) {
    $dirBytes = Get-DirSizeBytes -Path $d.FullName
    Remove-Item -LiteralPath $d.FullName -Recurse -Force -ErrorAction SilentlyContinue
    $removed++
    $reclaimedBytes += $dirBytes
  }

  return @{
    RemovedDirs = $removed
    ReclaimedMb = [math]::Round($reclaimedBytes / 1MB, 2)
  }
}

function Remove-OldHashedDepsArtifacts {
  param(
    [int]$KeepHashes,
    [switch]$Aggressive
  )

  if (-not (Test-Path $depsDir)) {
    return @{ RemovedFiles = 0; RemovedHashes = 0; ReclaimedMb = 0 }
  }

  $pattern = '^(?<base>.+)-(?<hash>[0-9a-f]{8,32})(?<ext>\.(rlib|rmeta|pdb|dll|lib|exp|exe|d))$'
  $candidates = @(Get-ChildItem -Path $depsDir -File -ErrorAction SilentlyContinue | Where-Object { $_.Name -match $pattern })
  if ($candidates.Count -eq 0) {
    return @{ RemovedFiles = 0; RemovedHashes = 0; ReclaimedMb = 0 }
  }

  $entries = foreach ($f in $candidates) {
    $m = [regex]::Match($f.Name, $pattern)
    [PSCustomObject]@{
      Base = $m.Groups["base"].Value
      Hash = $m.Groups["hash"].Value
      File = $f
    }
  }

  $removedFiles = 0
  $removedHashes = 0
  $reclaimedBytes = 0

  foreach ($baseGroup in ($entries | Group-Object Base)) {
    $hashGroups = foreach ($hashGroup in ($baseGroup.Group | Group-Object Hash)) {
      $newest = ($hashGroup.Group | Sort-Object { $_.File.LastWriteTime } -Descending | Select-Object -First 1).File.LastWriteTime
      [PSCustomObject]@{
        Hash = $hashGroup.Name
        Newest = $newest
        Items = $hashGroup.Group
      }
    }

    $oldHashes = $hashGroups | Sort-Object Newest -Descending | Select-Object -Skip $KeepHashes
    foreach ($hashEntry in $oldHashes) {
      if (-not $Aggressive -and $hashEntry.Newest -ge $cutoff) {
        continue
      }
      foreach ($item in $hashEntry.Items) {
        $full = $item.File.FullName
        $bytes = $item.File.Length
        Remove-Item -LiteralPath $full -Force -ErrorAction SilentlyContinue
        $removedFiles++
        $reclaimedBytes += $bytes
      }
      $removedHashes++
    }
  }

  return @{
    RemovedFiles = $removedFiles
    RemovedHashes = $removedHashes
    ReclaimedMb = [math]::Round($reclaimedBytes / 1MB, 2)
  }
}

function Remove-BuildScriptDirs {
  param([switch]$Aggressive)

  if (-not (Test-Path $buildDir)) {
    return @{ RemovedDirs = 0; ReclaimedMb = 0 }
  }

  $pattern = '^(?<base>.+)-(?<hash>[0-9a-f]{8,32})$'
  $dirs = @(Get-ChildItem -Path $buildDir -Directory -ErrorAction SilentlyContinue | Where-Object { $_.Name -match $pattern })
  if ($dirs.Count -eq 0) {
    return @{ RemovedDirs = 0; ReclaimedMb = 0 }
  }

  $entries = foreach ($d in $dirs) {
    $m = [regex]::Match($d.Name, $pattern)
    [PSCustomObject]@{
      Base = $m.Groups["base"].Value
      Dir = $d
    }
  }

  $toRemove = @()
  foreach ($baseGroup in ($entries | Group-Object Base)) {
    $sorted = $baseGroup.Group | Sort-Object { $_.Dir.LastWriteTime } -Descending
    if ($Aggressive) {
      $toRemove += $sorted | Select-Object -Skip 1
    } else {
      $toRemove += $sorted | Where-Object { $_.Dir.LastWriteTime -lt $cutoff }
    }
  }

  $removed = 0
  $reclaimedBytes = 0
  foreach ($entry in $toRemove) {
    $dirBytes = Get-DirSizeBytes -Path $entry.Dir.FullName
    Remove-Item -LiteralPath $entry.Dir.FullName -Recurse -Force -ErrorAction SilentlyContinue
    $removed++
    $reclaimedBytes += $dirBytes
  }

  return @{
    RemovedDirs = $removed
    ReclaimedMb = [math]::Round($reclaimedBytes / 1MB, 2)
  }
}

function Optimize-DebugArtifacts {
  param(
    [switch]$Aggressive,
    [string]$Reason
  )

  $beforeMb = Get-DirSizeMb -Path $debugDir
  $keepHashes = if ($Aggressive) { $keepHashesAggressive } else { $keepHashesNormal }
  $inc = Remove-IncrementalDirs -Aggressive:$Aggressive
  $deps = Remove-OldHashedDepsArtifacts -KeepHashes $keepHashes -Aggressive:$Aggressive
  $build = Remove-BuildScriptDirs -Aggressive:$Aggressive
  $afterMb = Get-DirSizeMb -Path $debugDir

  $mode = if ($Aggressive) { "aggressive" } else { "normal" }
  Write-Host "[target-opt] debug size: ${beforeMb}MB -> ${afterMb}MB, mode: $mode, reason: $Reason, incremental dirs: $($inc.RemovedDirs) (-$($inc.ReclaimedMb)MB), hashed deps: $($deps.RemovedFiles) files/$($deps.RemovedHashes) hashes (-$($deps.ReclaimedMb)MB), build dirs: $($build.RemovedDirs) (-$($build.ReclaimedMb)MB)"
}

function Invoke-OptimizeWithAuto {
  param([string]$Phase)

  $forced = $AggressiveCleanup -or $envAggressiveCleanup
  $reason = if ($forced) { "${Phase}:forced" } else { "${Phase}:normal" }
  Optimize-DebugArtifacts -Aggressive:$forced -Reason $reason

  if ($forced) {
    return
  }

  $autoTask = @("dev", "build", "build:exe") -contains $Task
  $sizeNow = Get-DirSizeMb -Path $debugDir
  if ($autoTask -and $sizeNow -ge $maxDebugMb) {
    Write-Host "[target-opt] debug exceeds threshold (${sizeNow}MB >= ${maxDebugMb}MB), run aggressive cleanup"
    Optimize-DebugArtifacts -Aggressive -Reason "${Phase}:auto-threshold"
  }
}

Write-Host "[target-opt] task: $Task"
Write-Host "[target-opt] repo: $repoRoot"
Write-Host "[target-opt] target dir: $targetDir"
Write-Host "[target-opt] config: staleDays=$staleDays, maxDebugMb=$maxDebugMb, keepHashes(normal/aggressive)=$keepHashesNormal/$keepHashesAggressive, keepIncrementalAggressive=$keepIncrementalAggressive, forceAggressive=$($AggressiveCleanup -or $envAggressiveCleanup)"

$isFrontendOnlyTask = @("dev:fast", "frontend:dev", "frontend:build") -contains $Task
if (-not $isFrontendOnlyTask) {
  $env:CARGO_TARGET_DIR = $targetDir
  $env:CARGO_INCREMENTAL = "1"
  $env:CARGO_PROFILE_DEV_INCREMENTAL = "true"
  $env:CARGO_PROFILE_TEST_INCREMENTAL = "true"
  $env:CARGO_PROFILE_RELEASE_INCREMENTAL = "true"
  Invoke-OptimizeWithAuto -Phase "pre"
} else {
  Write-Host "[target-opt] frontend-only task, skip target/debug optimize"
}

Push-Location $desktopDir
try {
  switch ($Task) {
    "postinstall" {
      npm install --prefix frontend
    }
    "dev" {
      npx tauri dev
    }
    "dev:fast" {
      npm run dev --prefix frontend
    }
    "build" {
      npx tauri build
    }
    "build:exe" {
      npx tauri build --target x86_64-pc-windows-msvc --no-bundle
    }
    "frontend:dev" {
      npm run dev --prefix frontend
    }
    "frontend:build" {
      npm run build --prefix frontend
    }
    "scan:timing:mft" {
      & (Join-Path $repoRoot "scripts\run_scan_timing_mft.ps1")
    }
    "scan:timing:mft:normal" {
      & (Join-Path $repoRoot "scripts\run_scan_timing_mft.ps1") -RunNormal
    }
  }

  if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
  }
} finally {
  Pop-Location
}

if (-not $isFrontendOnlyTask) {
  Invoke-OptimizeWithAuto -Phase "post"
}
