# PowerShell script to normalize all text files to CRLF line endings
# Run this script from the root of your repository

Write-Host "Normalizing line endings to CRLF..." -ForegroundColor Green

# Define file extensions to process
$extensions = @(
    "*.ts", "*.js", "*.html", "*.css", "*.scss", "*.json", "*.md", 
    "*.xml", "*.yaml", "*.yml", "*.toml", "*.config.js", "*.config.ts",
    ".prettierrc", ".editorconfig", ".gitignore", ".gitattributes"
)

# Define directories to exclude
$excludeDirs = @(
    "node_modules", ".git", "dist", "target", "src-tauri/target", 
    ".angular", "packages", "public/icons"
)

# Create exclude pattern for Get-ChildItem
$excludePattern = $excludeDirs -join "|"

$totalFiles = 0
$processedFiles = 0

foreach ($ext in $extensions) {
    Write-Host "Processing $ext files..." -ForegroundColor Yellow
    
    $files = Get-ChildItem -Path . -Filter $ext -Recurse -File | 
             Where-Object { $_.DirectoryName -notmatch $excludePattern }
    
    foreach ($file in $files) {
        $totalFiles++
        try {
            # Read file content
            $content = Get-Content -Path $file.FullName -Raw
            
            if ($content -ne $null) {
                # Convert LF to CRLF (normalize all line endings)
                $normalizedContent = $content -replace "`r`n", "`n" -replace "`n", "`r`n"
                
                # Only write if content changed
                if ($content -ne $normalizedContent) {
                    Set-Content -Path $file.FullName -Value $normalizedContent -NoNewline
                    $processedFiles++
                    Write-Host "  Converted: $($file.FullName)" -ForegroundColor Cyan
                }
            }
        }
        catch {
            Write-Warning "Failed to process: $($file.FullName) - $($_.Exception.Message)"
        }
    }
}

Write-Host "`nCompleted!" -ForegroundColor Green
Write-Host "Total files checked: $totalFiles" -ForegroundColor White
Write-Host "Files converted: $processedFiles" -ForegroundColor White

# Run git commands to refresh the index
Write-Host "`nRefreshing Git index..." -ForegroundColor Yellow
git add --renormalize .
git status --porcelain

Write-Host "`nLine ending normalization complete!" -ForegroundColor Green
Write-Host "Next steps:" -ForegroundColor Yellow
Write-Host "1. Review the changes with 'git diff'" -ForegroundColor White
Write-Host "2. Commit the line ending changes: git commit -m 'Normalize line endings to CRLF'" -ForegroundColor White
Write-Host "3. Run 'npm run format' to ensure consistent formatting" -ForegroundColor White