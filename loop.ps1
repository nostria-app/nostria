#!/usr/bin/env pwsh
# loop.ps1 - Ralphy GitHub issue watcher with idle improvement runs
# Works on both Windows and Linux (PowerShell 7+ / pwsh)
#
# Usage: pwsh loop.ps1
#        pwsh loop.ps1 -IdleThreshold 30 -PollInterval 60

param(
  [string]$Model = "github-copilot/claude-opus-4.6",
  [string]$Repo = "nostria-app/nostria",
  [string]$Label = "ready",
  [int]$PollInterval = 60,
  [int]$IdleThreshold = 60
)

function Write-Log {
  param([string]$Message)
  $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
  Write-Host "[$timestamp] $Message"
}

function Get-TaskCount {
  $output = & ralphy --opencode --model $Model --github $Repo --github-label $Label --dry-run --max-iterations 1 2>&1 | Out-String
  $clean = $output -replace "\x1b\[[0-9;]*m", ""
  if ($clean -match "Tasks remaining:\s*(\d+)") {
    return [int]$Matches[1]
  }
  return 0
}

function Sync-Git {
  param([string]$CommitMsg = "feat: complete ralphy task")

  Write-Log "Syncing with remote..."

  # If there are uncommitted changes (e.g. .ralphy/progress.txt), amend them
  # into ralphy's last commit instead of creating a separate commit.
  $status = & git status --porcelain
  if ($status) {
    & git add -A
    # Check if ralphy already made a commit that hasn't been pushed
    $ahead = & git rev-list --count "origin/main..HEAD"
    if ([int]$ahead -gt 0) {
      Write-Log "Amending leftover files into ralphy's commit..."
      & git commit --amend --no-edit
    } else {
      & git commit -m $CommitMsg
    }
  }

  & git fetch origin
  & git pull --rebase origin main
  & git push origin main
  Write-Log "Sync complete."
}

Write-Host ""
Write-Host "Ralphy GitHub issue watcher started."
Write-Host "Polling every $PollInterval seconds for issues labeled `"$Label`"..."
Write-Host "After $IdleThreshold minutes idle, will run codebase improvements."
Write-Host "Press Ctrl+C to stop."
Write-Host ""

$idleCount = 0

while ($true) {
  Write-Log "Checking for issues labeled `"$Label`"..."

  $taskCount = Get-TaskCount

  if ($taskCount -gt 0) {
    Write-Log "Found $taskCount issue(s). Running ralphy..."
    $idleCount = 0

    # Grab issue titles before ralphy removes the labels
    $issueTitles = & gh issue list --repo $Repo --label $Label --json title --jq ".[].title" 2>$null
    $commitMsg = "feat: complete ralphy task"
    if ($issueTitles) {
      # Use the first issue title as the commit message
      $firstTitle = ($issueTitles -split "`n")[0].Trim()
      if ($firstTitle) {
        $commitMsg = "feat: $firstTitle"
      }
    }

    & ralphy --opencode --model $Model --github $Repo --github-label $Label

    Write-Log "Ralphy finished. Syncing..."
    Sync-Git -CommitMsg $commitMsg

  } else {
    $idleCount++
    Write-Log "No issues found. Idle count: $idleCount/$IdleThreshold"

    if ($idleCount -ge $IdleThreshold) {
      Write-Host ""
      Write-Host "============================================================"
      Write-Log "Idle for $IdleThreshold minutes. Running codebase improvements..."
      Write-Host "============================================================"
      Write-Host ""

      $idleCount = 0

      # Fetch + pull before starting work
      & git fetch origin
      & git pull --rebase origin main

      & ralphy --opencode --model $Model --prd IMPROVEMENTS.md --max-iterations 1

      Write-Log "Improvement task finished. Syncing..."
      Sync-Git -CommitMsg "chore: codebase improvement"
    }
  }

  Write-Log "Waiting $PollInterval seconds..."
  Start-Sleep -Seconds $PollInterval
}
