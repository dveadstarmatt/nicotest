# Nico AI Push Script
# Usage: .\push-nico.ps1 or .\push-nico.ps1 "Your commit message"

param(
    [string]$message = "Update Nico AI"
)

# Change to nico-project directory
Set-Location $PSScriptRoot

# Check if git is initialized
if (-not (Test-Path .git)) {
    Write-Host "Error: Not in a Git repository" -ForegroundColor Red
    exit 1
}

# Display what will be pushed
Write-Host "`n=== Git Status ===" -ForegroundColor Cyan
git status --short

# Stage all changes
Write-Host "`nStaging all changes..." -ForegroundColor Yellow
git add .

# Commit with message
Write-Host "Committing with message: '$message'" -ForegroundColor Yellow
git commit -m $message

# Push to GitHub
Write-Host "Pushing to GitHub..." -ForegroundColor Yellow
git push origin main

# Show result
if ($LASTEXITCODE -eq 0) {
    Write-Host "`n✅ Successfully pushed to GitHub!" -ForegroundColor Green
} else {
    Write-Host "`n❌ Push failed. Check the errors above." -ForegroundColor Red
}
