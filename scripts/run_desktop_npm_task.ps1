param(
  [ValidateSet("postinstall", "dev", "dev:fast", "build", "build:exe", "frontend:dev", "frontend:build", "scan:timing:mft", "scan:timing:mft:normal")]
  [string]$Task
)

$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$desktopDir = Join-Path $repoRoot "apps\desktop"
$targetDir = Join-Path $repoRoot "target"
$debugDir = Join-Path $targetDir "debug"
$depsDir = Join-Path $debugDir "deps"
$incrementalDir = Join-Path $debugDir "incremental"
$cutoff = (Get-Date).AddDays(-7)

function Get-DirSizeMb {
  param([string]$Path)
  if (-not (Test-Path $Path)) {
    return 0
  }
  $bytes = (Get-ChildItem -Path $Path -Recurse -File -ErrorAction SilentlyContinue | Measure-Object Length -Sum).Sum
  if ($null -eq $bytes) {
    return 0
  }
  return [math]::Round(($bytes / 1MB), 2)
}

function Remove-StaleIncrementalDirs {
  if (-not (Test-Path $incrementalDir)) {
    return 0
  }
  $dirs = Get-ChildItem -Path $incrementalDir -Directory -ErrorAction SilentlyContinue |
    Where-Object { $_.LastWriteTime -lt $cutoff }
  foreach ($d in $dirs) {
    Remove-Item -LiteralPath $d.FullName -Recurse -Force -ErrorAction SilentlyContinue
  }
  return $dirs.Count
}

function Remove-OldHashedExecutables {
  if (-not (Test-Path $depsDir)) {
    return 0
  }

  $removed = 0
  $exeFiles = Get-ChildItem -Path $depsDir -File -Filter "*.exe" -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -match "^(?<base>.+)-[0-9a-f]{16}\.exe$" } |
    Group-Object { [regex]::Match($_.Name, "^(?<base>.+)-[0-9a-f]{16}\.exe$").Groups["base"].Value }

  foreach ($group in $exeFiles) {
    $old = $group.Group | Sort-Object LastWriteTime -Descending | Select-Object -Skip 2
    foreach ($f in $old) {
      if ($f.LastWriteTime -ge $cutoff) {
        continue
      }
      $full = $f.FullName
      $baseName = [System.IO.Path]::GetFileNameWithoutExtension($full)
      Remove-Item -LiteralPath $full -Force -ErrorAction SilentlyContinue
      foreach ($ext in @(".pdb", ".d", ".exp", ".lib")) {
        $sidecar = Join-Path $depsDir ($baseName + $ext)
        if (Test-Path $sidecar) {
          Remove-Item -LiteralPath $sidecar -Force -ErrorAction SilentlyContinue
        }
      }
      $removed++
    }
  }
  return $removed
}

function Optimize-DebugArtifacts {
  $beforeMb = Get-DirSizeMb -Path $debugDir
  $removedInc = Remove-StaleIncrementalDirs
  $removedExe = Remove-OldHashedExecutables
  $afterMb = Get-DirSizeMb -Path $debugDir
  Write-Host "[target-opt] debug size: ${beforeMb}MB -> ${afterMb}MB, removed incremental dirs: $removedInc, removed old test bins: $removedExe"
}

Write-Host "[target-opt] task: $Task"
Write-Host "[target-opt] repo: $repoRoot"
Write-Host "[target-opt] target dir: $targetDir"

$isFrontendOnlyTask = @("dev:fast", "frontend:dev", "frontend:build") -contains $Task
if (-not $isFrontendOnlyTask) {
  $env:CARGO_TARGET_DIR = $targetDir
  $env:CARGO_INCREMENTAL = "1"
  $env:CARGO_PROFILE_DEV_INCREMENTAL = "true"
  $env:CARGO_PROFILE_TEST_INCREMENTAL = "true"
  $env:CARGO_PROFILE_RELEASE_INCREMENTAL = "true"
  Optimize-DebugArtifacts
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
  Optimize-DebugArtifacts
}
