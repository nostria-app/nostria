$ErrorActionPreference = 'Stop'

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
$manifestPath = Join-Path $repoRoot 'src-tauri/icons/android-icon-manifest.json'
$tempRoot = Join-Path $env:TEMP ('nostria-tauri-android-icons-' + [guid]::NewGuid().ToString('N'))
$targetRes = Join-Path $repoRoot 'src-tauri/gen/android/app/src/main/res'

try {
  New-Item -ItemType Directory -Path $tempRoot | Out-Null

  Push-Location $repoRoot
  try {
    npx tauri icon $manifestPath -o $tempRoot
  }
  finally {
    Pop-Location
  }

  $generatedRes = Join-Path $tempRoot 'android'
  if (-not (Test-Path $generatedRes)) {
    throw "Expected generated Android resources at '$generatedRes'."
  }

  $resourceDirs = @(
    'mipmap-anydpi-v26',
    'mipmap-mdpi',
    'mipmap-hdpi',
    'mipmap-xhdpi',
    'mipmap-xxhdpi',
    'mipmap-xxxhdpi',
    'drawable-v24',
    'values'
  )

  foreach ($resourceDir in $resourceDirs) {
    $sourceDir = Join-Path $generatedRes $resourceDir
    if (-not (Test-Path $sourceDir)) {
      continue
    }

    $destinationDir = Join-Path $targetRes $resourceDir
    if (-not (Test-Path $destinationDir)) {
      New-Item -ItemType Directory -Path $destinationDir -Force | Out-Null
    }

    Copy-Item -Path (Join-Path $sourceDir '*') -Destination $destinationDir -Recurse -Force
  }
}
finally {
  if (Test-Path $tempRoot) {
    Remove-Item -Path $tempRoot -Recurse -Force
  }
}