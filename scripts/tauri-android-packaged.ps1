param(
  [switch]$Emulator,
  [switch]$PhysicalDevice,
  [switch]$Build,
  [switch]$Run,
  [switch]$Release,
  [switch]$UseDebugKey,
  [switch]$DryRun,
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$TauriArgs
)

if ($Emulator -and $PhysicalDevice) {
  throw 'Use either -Emulator or -PhysicalDevice, not both.'
}

if ($Build -and $Run) {
  throw 'Use either -Build or -Run, not both.'
}

if (-not $Build -and -not $Run) {
  throw 'Specify either -Build or -Run.'
}

if (-not $Release) {
  throw 'Tauri Android debug builds still embed a dev server URL (10.0.2.2 on the emulator). Use the dev helper for debug sessions, or use -Release -UseDebugKey for a fully packaged local APK.'
}

$root = Resolve-Path (Join-Path $PSScriptRoot '..')
$tauriCmd = Join-Path $root 'node_modules/.bin/tauri.cmd'

if (-not (Test-Path $tauriCmd)) {
  throw "Tauri CLI not found at $tauriCmd. Run npm install first."
}

function Get-AdbPath {
  $sdkRoots = @($env:ANDROID_HOME, $env:ANDROID_SDK_ROOT) | Where-Object { $_ }

  foreach ($sdkRoot in $sdkRoots) {
    $candidate = Join-Path $sdkRoot 'platform-tools/adb.exe'
    if (Test-Path $candidate) {
      return $candidate
    }
  }

  $command = Get-Command adb -ErrorAction SilentlyContinue
  if ($command) {
    return $command.Source
  }

  return $null
}

function Get-ConnectedDevices {
  $adbPath = Get-AdbPath
  if (-not $adbPath) {
    return @()
  }

  $adbOutput = & $adbPath devices 2>$null
  if ($LASTEXITCODE -ne 0) {
    return @()
  }

  return @(
    $adbOutput |
    Select-Object -Skip 1 |
    Where-Object { $_ -match "\tdevice$" } |
    ForEach-Object {
      $serial = ($_ -split "\t")[0].Trim()
      [PSCustomObject]@{
        Serial = $serial
        IsEmulator = $serial.StartsWith('emulator-')
      }
    }
  )
}

function Resolve-TargetConfig {
  if ($Emulator) {
    return [PSCustomObject]@{
      Abi = 'x86_64'
      Arch = 'x86_64'
      Target = 'x86_64'
      Flavor = 'x86_64'
      Reason = 'packaging only the emulator ABI (x86_64)'
      RequireEmulator = $true
    }
  }

  if ($PhysicalDevice) {
    return [PSCustomObject]@{
      Abi = 'arm64-v8a'
      Arch = 'arm64'
      Target = 'aarch64'
      Flavor = 'arm64'
      Reason = 'packaging only the physical-device ABI (arm64-v8a)'
      RequireEmulator = $false
    }
  }

  return $null
}

function Resolve-ApkPath {
  param(
    [string]$Flavor,
    [bool]$IsRelease
  )

  if ($IsRelease) {
    return Join-Path $root 'src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release.apk'
  }

  $buildType = if ($IsRelease) { 'release' } else { 'debug' }
  return Join-Path $root "src-tauri/gen/android/app/build/outputs/apk/$Flavor/$buildType/app-$Flavor-$buildType.apk"
}

function Resolve-DeviceSerial {
  param([bool]$RequireEmulator)

  $devices = @(Get-ConnectedDevices)
  if ($RequireEmulator) {
    $devices = @($devices | Where-Object { $_.IsEmulator })
    if ($devices.Count -eq 0) {
      throw 'No Android emulator detected. Start an emulator first.'
    }
    if ($devices.Count -gt 1) {
      throw 'Multiple Android emulators detected. Keep only one running before using the emulator packaged run helper.'
    }
  }
  elseif ($PhysicalDevice) {
    $devices = @($devices | Where-Object { -not $_.IsEmulator })
    if ($devices.Count -eq 0) {
      throw 'No physical Android device detected.'
    }
    if ($devices.Count -gt 1) {
      throw 'Multiple physical Android devices detected. Keep only one connected before using the packaged run helper.'
    }
  }
  elseif ($devices.Count -eq 0) {
    throw 'No Android device detected.'
  }
  elseif ($devices.Count -gt 1) {
    throw 'Multiple Android devices detected. Use -Emulator or -PhysicalDevice to disambiguate.'
  }

  return $devices[0].Serial
}

function Invoke-PackagedBuild {
  param([string[]]$CommandArgs)

  & $tauriCmd @CommandArgs
  if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
  }
}

$abiList = $null
$archList = $null
$targetList = $null
$selectionReason = $null
$targetConfig = Resolve-TargetConfig
if ($targetConfig) {
  $abiList = $targetConfig.Abi
  $archList = $targetConfig.Arch
  $targetList = $targetConfig.Target
  $selectionReason = $targetConfig.Reason
}

$commandArgs = @('android')
if ($Build) {
  $commandArgs += 'build'
  $commandArgs += '--apk'
  if (-not $Release) {
    $commandArgs += '--debug'
  }
}
else {
  $commandArgs += 'run'
  if ($Release) {
    $commandArgs += '--release'
  }
}

if ($targetList) {
  $commandArgs += @('--target', $targetList)
}
$commandArgs += $TauriArgs

$action = 'run'
if ($Build) {
  $action = 'build'
}

if ($selectionReason) {
  Write-Host "Starting packaged Tauri Android $action ($selectionReason)."
}
else {
  Write-Host "Starting packaged Tauri Android $action."
}

if ($Release -and $UseDebugKey) {
  Write-Host 'Using the Android debug keystore for a local release-style package.'
}

$previousAbiList = $env:ORG_GRADLE_PROJECT_abiList
$previousArchList = $env:ORG_GRADLE_PROJECT_archList
$previousTargetList = $env:ORG_GRADLE_PROJECT_targetList
$previousReleaseKeyMode = $env:TAURI_ANDROID_RELEASE_USE_DEBUG_KEY
$previousTauriConfig = $env:TAURI_CONFIG

if ($abiList) {
  $env:ORG_GRADLE_PROJECT_abiList = $abiList
  $env:ORG_GRADLE_PROJECT_archList = $archList
  $env:ORG_GRADLE_PROJECT_targetList = $targetList
}

if ($Release -and $UseDebugKey) {
  $env:TAURI_ANDROID_RELEASE_USE_DEBUG_KEY = 'true'
}

if ($null -ne $env:TAURI_CONFIG) {
  Remove-Item Env:TAURI_CONFIG -ErrorAction SilentlyContinue
}

if ($DryRun) {
  $adbPath = Get-AdbPath
  if ($abiList) {
    Write-Host "ORG_GRADLE_PROJECT_abiList=$($env:ORG_GRADLE_PROJECT_abiList)"
    Write-Host "ORG_GRADLE_PROJECT_archList=$($env:ORG_GRADLE_PROJECT_archList)"
    Write-Host "ORG_GRADLE_PROJECT_targetList=$($env:ORG_GRADLE_PROJECT_targetList)"
  }
  if ($Release -and $UseDebugKey) {
    Write-Host "TAURI_ANDROID_RELEASE_USE_DEBUG_KEY=$($env:TAURI_ANDROID_RELEASE_USE_DEBUG_KEY)"
  }

  if ($Run -and $targetConfig) {
    $buildArgs = @('android', 'build', '--apk', '--target', $targetConfig.Target)
    if (-not $Release) {
      $buildArgs += '--debug'
    }
    $buildArgs += $TauriArgs

    $apkPath = Resolve-ApkPath -Flavor $targetConfig.Flavor -IsRelease:$Release
    Write-Host "$tauriCmd $($buildArgs -join ' ')"
    if ($adbPath) {
      Write-Host "$adbPath -s <device-serial> install -r $apkPath"
      Write-Host "$adbPath -s <device-serial> shell am start -n app.nostria/.MainActivity"
    }
    exit 0
  }

  Write-Host "$tauriCmd $($commandArgs -join ' ')"
  exit 0
}

try {
  if ($Run -and $targetConfig) {
    $buildArgs = @('android', 'build', '--apk', '--target', $targetConfig.Target)
    if (-not $Release) {
      $buildArgs += '--debug'
    }
    $buildArgs += $TauriArgs

    Invoke-PackagedBuild -CommandArgs $buildArgs

    $apkPath = Resolve-ApkPath -Flavor $targetConfig.Flavor -IsRelease:$Release
    if (-not (Test-Path $apkPath)) {
      throw "Expected APK was not generated at $apkPath"
    }

    $adbPath = Get-AdbPath
    if (-not $adbPath) {
      throw 'adb.exe was not found. Ensure Android SDK platform-tools is installed.'
    }

    $deviceSerial = Resolve-DeviceSerial -RequireEmulator:$targetConfig.RequireEmulator
    Write-Host "Installing $apkPath on device $deviceSerial."
    & $adbPath -s $deviceSerial install -r $apkPath
    if ($LASTEXITCODE -ne 0) {
      exit $LASTEXITCODE
    }

    Write-Host 'Launching app.nostria/.MainActivity.'
    & $adbPath -s $deviceSerial shell am start -n 'app.nostria/.MainActivity'
    exit $LASTEXITCODE
  }

  & $tauriCmd @commandArgs
  exit $LASTEXITCODE
}
finally {
  $env:ORG_GRADLE_PROJECT_abiList = $previousAbiList
  $env:ORG_GRADLE_PROJECT_archList = $previousArchList
  $env:ORG_GRADLE_PROJECT_targetList = $previousTargetList
  $env:TAURI_ANDROID_RELEASE_USE_DEBUG_KEY = $previousReleaseKeyMode
  $env:TAURI_CONFIG = $previousTauriConfig
}