$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot
Write-Host "Starting Nico backend..."
python main.py
