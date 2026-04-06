$ErrorActionPreference = 'Stop'

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
$manifestPath = Join-Path $repoRoot 'src-tauri/icons/android-icon-manifest.json'
$sourceIcon = Join-Path $repoRoot 'src-tauri/icons/icon.png'
$tempRoot = Join-Path $env:TEMP ('nostria-tauri-android-icons-' + [guid]::NewGuid().ToString('N'))
$targetRes = Join-Path $repoRoot 'src-tauri/gen/android/app/src/main/res'

function Write-ResizedPng {
  param(
    [string]$InputPath,
    [string]$OutputPath,
    [int]$Size
  )

  Add-Type -AssemblyName System.Drawing

  $source = [System.Drawing.Image]::FromFile($InputPath)
  try {
    $bitmap = New-Object System.Drawing.Bitmap $Size, $Size
    try {
      $bitmap.SetResolution($source.HorizontalResolution, $source.VerticalResolution)
      $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
      try {
        $graphics.Clear([System.Drawing.Color]::Transparent)
        $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
        $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
        $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
        $graphics.DrawImage($source, 0, 0, $Size, $Size)
        $bitmap.Save($OutputPath, [System.Drawing.Imaging.ImageFormat]::Png)
      }
      finally {
        $graphics.Dispose()
      }
    }
    finally {
      $bitmap.Dispose()
    }
  }
  finally {
    $source.Dispose()
  }
}

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

  $legacySizes = @{
    'mipmap-mdpi' = 48
    'mipmap-hdpi' = 72
    'mipmap-xhdpi' = 96
    'mipmap-xxhdpi' = 144
    'mipmap-xxxhdpi' = 192
  }

  foreach ($entry in $legacySizes.GetEnumerator()) {
    $destinationDir = Join-Path $targetRes $entry.Key
    Write-ResizedPng -InputPath $sourceIcon -OutputPath (Join-Path $destinationDir 'ic_launcher.png') -Size $entry.Value
    Write-ResizedPng -InputPath $sourceIcon -OutputPath (Join-Path $destinationDir 'ic_launcher_round.png') -Size $entry.Value
  }
}
finally {
  if (Test-Path $tempRoot) {
    Remove-Item -Path $tempRoot -Recurse -Force
  }
}