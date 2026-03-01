param(
  [string]$BaseUrl = 'https://nostria.app',
  [string]$OutFile = '',
  [int]$TimeoutSec = 60,
  [int]$InterPassDelaySec = 2
)

$ProgressPreference = 'SilentlyContinue'

$root = Resolve-Path (Join-Path $PSScriptRoot '..')
$testResultsDir = Join-Path $root 'test-results'
New-Item -ItemType Directory -Force -Path $testResultsDir | Out-Null

if ([string]::IsNullOrWhiteSpace($OutFile)) {
  $hostName = ([uri]$BaseUrl).Host.Replace('.', '-')
  $OutFile = Join-Path $testResultsDir ("social-preview-check-$hostName.txt")
} elseif (-not [System.IO.Path]::IsPathRooted($OutFile)) {
  $OutFile = Join-Path $root $OutFile
}

if (Test-Path $OutFile) {
  Remove-Item $OutFile -Force
}

$eventPaths = @(
  '/e/nevent1qvzqqqqqqypzpm0sm29mm0s3r90m3psed2a07kr2jzfvmnyuqqtmww7enzex2tarqy88wumn8ghj7mn0wvhxcmmv9uqzqt33ge82hpgzlan47n583kj8559hhtxlggurk4lt4s0zfvzaqs4ytjdzsj',
  '/e/nevent1qvzqqqqqqypzp42ptgcn6wzxrlun4rqhp72pktx55e49eldmpy6qd9s0dje30pylqythwumn8ghj7un9d3shjtnswf5k6ctv9ehx2ap0qqs04r5xcnh792uckhzgypn0kav6vzsff4d79d6nq7dhm4ayg8j6seg67dxm8',
  '/e/nevent1qvzqqqqqqypzq9lz3z0m5qgzr5zg5ylapwss3tf3cwpjv225vrppu6wy8750heg4qy88wumn8ghj7mn0wvhxcmmv9uqzqqqqxztt8tft7pq3ttk3qkdn4j5galmduuvj7vmm72z3k0ju98alq9wfvz'
)

$urls = $eventPaths | ForEach-Object {
  if ($BaseUrl.EndsWith('/')) {
    $BaseUrl.TrimEnd('/') + $_
  } else {
    $BaseUrl + $_
  }
}

$agents = @('Discordbot/2.0', 'Twitterbot/1.0', 'facebookexternalhit/1.1')
$passes = @('warmup', 'second')

foreach ($pass in $passes) {
  Add-Content -Path $OutFile -Value ("PASS=$pass")

  foreach ($url in $urls) {
    foreach ($agent in $agents) {
      try {
        $stopwatch = [System.Diagnostics.Stopwatch]::StartNew()
        $response = Invoke-WebRequest -Uri $url -Headers @{'User-Agent' = $agent} -UseBasicParsing -TimeoutSec $TimeoutSec -ErrorAction Stop
        $stopwatch.Stop()

        $content = $response.Content
        $og = ([regex]::Match($content, '<meta\s+property="og:title"\s+content="([^"]*)"', 'IgnoreCase')).Groups[1].Value
        if ([string]::IsNullOrWhiteSpace($og)) {
          $og = ([regex]::Match($content, '<meta\s+content="([^"]*)"\s+property="og:title"', 'IgnoreCase')).Groups[1].Value
        }

        $tw = ([regex]::Match($content, '<meta\s+name="twitter:title"\s+content="([^"]*)"', 'IgnoreCase')).Groups[1].Value
        if ([string]::IsNullOrWhiteSpace($tw)) {
          $tw = ([regex]::Match($content, '<meta\s+content="([^"]*)"\s+name="twitter:title"', 'IgnoreCase')).Groups[1].Value
        }

        $cache = ($response.Headers['X-SSR-Cache'] -join ',')
        $quality = ($response.Headers['X-SSR-Preview-Quality'] -join ',')
        $reason = ($response.Headers['X-SSR-Preview-Reason'] -join ',')

        $line = '{0}|{1}|{2}|status={3}|cache={4}|quality={5}|reason={6}|ms={7}|og={8}|tw={9}' -f $pass, $agent, $url, [int]$response.StatusCode, $cache, $quality, $reason, $stopwatch.ElapsedMilliseconds, $og, $tw
        Add-Content -Path $OutFile -Value $line
      }
      catch {
        $errorMessage = $_.Exception.Message -replace '\r|\n', ' '
        $line = '{0}|{1}|{2}|ERROR={3}' -f $pass, $agent, $url, $errorMessage
        Add-Content -Path $OutFile -Value $line
      }
    }
  }

  if ($InterPassDelaySec -gt 0) {
    Start-Sleep -Seconds $InterPassDelaySec
  }
}

Write-Output "WROTE $OutFile"
