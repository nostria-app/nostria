# check-issues.ps1
# Helper script for loop.bat
# Runs ralphy in dry-run mode and outputs the number of pending tasks.
# Returns "0" if no tasks are available, or the task count if issues exist.

param(
  [string]$Model = "github-copilot/claude-opus-4.6",
  [string]$Repo = "nostria-app/nostria",
  [string]$Label = "ready"
)

$output = ralphy --opencode --model $Model --github $Repo --github-label $Label --dry-run --max-iterations 1 2>&1 | Out-String

# Strip ANSI escape codes
$clean = $output -replace "\x1b\[[0-9;]*m", ""

# Extract task count from "Tasks remaining: N"
if ($clean -match "Tasks remaining:\s*(\d+)") {
  Write-Output $Matches[1]
} else {
  Write-Output "0"
}
