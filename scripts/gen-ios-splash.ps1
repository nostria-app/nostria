param(
  [string]$LogoPath = 'public/icons/nostria.png',
  [string]$SplashDir = 'public/splash',
  [double]$LogoScale = 0.72,
  [string]$BackgroundHex = '#0a0a0a'
)

$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Drawing

function Convert-HexToColor {
  param([string]$Hex)

  $clean = $Hex.Trim().TrimStart('#')
  if ($clean.Length -ne 6) {
    throw "BackgroundHex must be a 6-digit hex color like #0a0a0a"
  }

  $r = [Convert]::ToInt32($clean.Substring(0, 2), 16)
  $g = [Convert]::ToInt32($clean.Substring(2, 2), 16)
  $b = [Convert]::ToInt32($clean.Substring(4, 2), 16)
  return [System.Drawing.Color]::FromArgb($r, $g, $b)
}

if ($LogoScale -le 0 -or $LogoScale -gt 1) {
  throw 'LogoScale must be in the range (0, 1].'
}

$logoFullPath = Join-Path $PWD $LogoPath
$splashFullDir = Join-Path $PWD $SplashDir

if (-not (Test-Path $logoFullPath)) {
  throw "Logo not found: $logoFullPath"
}

if (-not (Test-Path $splashFullDir)) {
  throw "Splash directory not found: $splashFullDir"
}

$bgColor = Convert-HexToColor -Hex $BackgroundHex
$logo = [System.Drawing.Image]::FromFile($logoFullPath)

try {
  $files = Get-ChildItem $splashFullDir -Filter 'apple-splash-*.png'
  $updated = 0

  foreach ($file in $files) {
    $img = [System.Drawing.Image]::FromFile($file.FullName)
    $width = $img.Width
    $height = $img.Height
    $img.Dispose()

    $bitmap = New-Object System.Drawing.Bitmap($width, $height)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)

    $graphics.Clear($bgColor)
    $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality

    $logoSize = [Math]::Round([Math]::Min($width, $height) * $LogoScale)
    $x = [Math]::Round(($width - $logoSize) / 2)
    $y = [Math]::Round(($height - $logoSize) / 2)

    $graphics.DrawImage($logo, $x, $y, $logoSize, $logoSize)
    $bitmap.Save($file.FullName, [System.Drawing.Imaging.ImageFormat]::Png)

    $graphics.Dispose()
    $bitmap.Dispose()
    $updated++
  }

  Write-Output "Updated splash images: $updated"
}
finally {
  $logo.Dispose()
}
