param(
  [switch]$Emulator,
  [switch]$PhysicalDevice,
  [switch]$DryRun,
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$TauriArgs
)

if ($Emulator -and $PhysicalDevice) {
  throw 'Use either -Emulator or -PhysicalDevice, not both.'
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

function Get-ConnectedDeviceSerials {
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
    ForEach-Object { ($_ -split "\t")[0].Trim() } |
    Where-Object { $_ }
  )
}

function Get-ConnectedDevices {
  return @(
    Get-ConnectedDeviceSerials |
    ForEach-Object {
      [PSCustomObject]@{
        Serial     = $_
        IsEmulator = $_.StartsWith('emulator-')
      }
    }
  )
}

function Get-RequestedDevice {
  param([string[]]$Args)

  for ($index = 0; $index -lt $Args.Length; $index++) {
    $arg = $Args[$index]

    if ($arg -eq '--device' -and $index + 1 -lt $Args.Length) {
      return $Args[$index + 1]
    }

    if ($arg.StartsWith('--device=')) {
      return $arg.Substring('--device='.Length)
    }

    if (-not $arg.StartsWith('-')) {
      return $arg
    }
  }

  return $null
}

$hostOverride = $null
$hostReason = $null

if ($Emulator) {
  $hostOverride = '10.0.2.2'
  $hostReason = 'forced emulator mode'
}
elseif ($PhysicalDevice) {
  $requestedDevice = Get-RequestedDevice -Args $TauriArgs
  $connectedDevices = Get-ConnectedDevices
  $physicalDevices = @($connectedDevices | Where-Object { -not $_.IsEmulator })

  if (-not $requestedDevice -and $physicalDevices.Count -eq 1) {
    $requestedDevice = $physicalDevices[0].Serial
    $TauriArgs = @($requestedDevice) + $TauriArgs
  }

  if ($requestedDevice) {
    $hostReason = "forced physical-device mode for '$requestedDevice'"
  }
  elseif ($physicalDevices.Count -gt 1) {
    Write-Host 'Multiple physical Android devices detected. Pass a specific serial, for example:'
    Write-Host 'npm run tauri:android:dev:device -- SERIAL'
    exit 1
  }
  else {
    Write-Host 'No physical Android device detected. Connect your phone or use npm run tauri:android:dev:emulator.'
    exit 1
  }
}
else {
  $requestedDevice = Get-RequestedDevice -Args $TauriArgs
  $connectedDevices = @(Get-ConnectedDevices)
  $emulatorDevices = @($connectedDevices | Where-Object { $_.IsEmulator })

  if ($requestedDevice -and $requestedDevice.StartsWith('emulator-')) {
    $hostOverride = '10.0.2.2'
    $hostReason = "requested device '$requestedDevice' is an emulator"
  }
  elseif ($connectedDevices.Count -eq 1 -and $connectedDevices[0].IsEmulator) {
    $hostOverride = '10.0.2.2'
    $hostReason = "detected emulator '$($connectedDevices[0].Serial)'"
  }
  elseif ($connectedDevices.Count -eq 1) {
    $hostReason = "detected physical device '$($connectedDevices[0].Serial)'"
  }
  elseif ($connectedDevices.Count -gt 1 -and $emulatorDevices.Count -gt 0) {
    Write-Host 'Multiple Android devices detected. Leaving Tauri host selection unchanged.'
    Write-Host 'Use npm run tauri:android:dev:emulator for the emulator or pass -- --device emulator-5554.'
  }
}

$commandArgs = @('android', 'dev')
if ($hostOverride) {
  $commandArgs += @('--host', $hostOverride)
}
$commandArgs += $TauriArgs

if ($hostReason) {
  Write-Host "Starting Tauri Android dev ($hostReason)."
}

if ($DryRun) {
  Write-Host "$tauriCmd $($commandArgs -join ' ')"
  exit 0
}

& $tauriCmd @commandArgs
exit $LASTEXITCODE