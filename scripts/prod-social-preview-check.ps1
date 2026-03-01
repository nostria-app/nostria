$root = Resolve-Path (Join-Path $PSScriptRoot '..')
$script = Join-Path $PSScriptRoot 'social-preview-check.ps1'
$output = Join-Path $root 'test-results/prod-social-preview-check.txt'

powershell -ExecutionPolicy Bypass -File $script -BaseUrl 'https://nostria.app' -OutFile $output
