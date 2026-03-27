# Usage: .\release.ps1 -Token "ghp_your_token"
# Before running: update "version" in src-tauri/tauri.conf.json
param(
    [Parameter(Mandatory=$true)]
    [string]$Token
)

$ErrorActionPreference = "Stop"
$REPO = "m3ch4nism/mechanism"
$ROOT = $PSScriptRoot
$KEY_FILE = "$ROOT\~\.tauri\mechanism.key"

$conf = Get-Content "$ROOT\src-tauri\tauri.conf.json" -Raw | ConvertFrom-Json
$VERSION = $conf.version
$TAG = "v$VERSION"

Write-Host "`n=== mechanism release $TAG ===`n" -ForegroundColor Cyan

# 1. Build
Write-Host "[1/5] Building..." -ForegroundColor Yellow
try { taskkill /F /IM "amazon-mail.exe" 2>$null } catch {}
Start-Sleep 1
Push-Location $ROOT
npx tauri build
if ($LASTEXITCODE -ne 0) { throw "Build failed" }
Pop-Location

# 2. Find exe
Write-Host "[2/5] Locating files..." -ForegroundColor Yellow
$nsisDir = "$ROOT\src-tauri\target\release\bundle\nsis"
$msiDir = "$ROOT\src-tauri\target\release\bundle\msi"
$setupExe = Get-ChildItem "$nsisDir\mechanism_${VERSION}_x64-setup.exe" -ErrorAction Stop
$msiFile = Get-ChildItem "$msiDir\mechanism_${VERSION}_x64_en-US.msi" -ErrorAction SilentlyContinue
Write-Host "  $($setupExe.Name) ($([math]::Round($setupExe.Length/1MB,1)) MB)"

# 3. Sign
Write-Host "[3/5] Signing..." -ForegroundColor Yellow
$key = (Get-Content $KEY_FILE -Raw).Trim()
Push-Location $ROOT
npx tauri signer sign "$($setupExe.FullName)" --private-key "$key" --password '""'
Pop-Location
$sigFile = "$($setupExe.FullName).sig"
if (!(Test-Path $sigFile)) { throw "Signature failed" }
$sig = (Get-Content $sigFile -Raw).Trim()
Write-Host "  Signed OK"

# 4. Create latest.json
Write-Host "[4/5] Creating latest.json..." -ForegroundColor Yellow
$latestJson = @{
    version = $VERSION
    notes = "mechanism $TAG"
    pub_date = (Get-Date -Format "yyyy-MM-ddTHH:mm:ssZ")
    platforms = @{
        "windows-x86_64" = @{
            signature = $sig
            url = "https://github.com/$REPO/releases/download/$TAG/$($setupExe.Name)"
        }
    }
} | ConvertTo-Json -Depth 4
$latestPath = "$nsisDir\latest.json"
[System.IO.File]::WriteAllText($latestPath, $latestJson, (New-Object System.Text.UTF8Encoding $false))

# 5. GitHub Release
Write-Host "[5/5] Uploading to GitHub..." -ForegroundColor Yellow
$headers = @{ Authorization = "token $Token"; Accept = "application/vnd.github.v3+json" }

$sha = (git rev-parse HEAD).Trim()
try {
    Invoke-RestMethod -Uri "https://api.github.com/repos/$REPO/git/refs" -Method Post -Headers $headers -ContentType "application/json" -Body (@{ ref = "refs/tags/$TAG"; sha = $sha } | ConvertTo-Json) | Out-Null
} catch {
    try { Invoke-RestMethod -Uri "https://api.github.com/repos/$REPO/git/refs/tags/$TAG" -Method Patch -Headers $headers -ContentType "application/json" -Body (@{ sha = $sha } | ConvertTo-Json) | Out-Null } catch {}
}

try {
    $existing = Invoke-RestMethod -Uri "https://api.github.com/repos/$REPO/releases/tags/$TAG" -Headers $headers
    Invoke-RestMethod -Uri "https://api.github.com/repos/$REPO/releases/$($existing.id)" -Method Delete -Headers $headers | Out-Null
} catch {}

$release = Invoke-RestMethod -Uri "https://api.github.com/repos/$REPO/releases" -Method Post -Headers $headers -ContentType "application/json" -Body (@{
    tag_name = $TAG; name = "mechanism $TAG"
    body = "Download mechanism_${VERSION}_x64-setup.exe or .msi below."
    draft = $false; prerelease = $false
} | ConvertTo-Json)
$uploadUrl = $release.upload_url -replace '\{\?.*\}', ''

function Upload($path, $name, $ct = "application/octet-stream") {
    $bytes = [System.IO.File]::ReadAllBytes($path)
    Invoke-RestMethod -Uri "${uploadUrl}?name=$name" -Method Post -Headers @{ Authorization = "token $Token"; "Content-Type" = $ct } -Body $bytes | Out-Null
    Write-Host "  $name ($([math]::Round($bytes.Length/1MB,1)) MB)"
}

Upload $setupExe.FullName $setupExe.Name
if ($msiFile) { Upload $msiFile.FullName $msiFile.Name }
Upload $latestPath "latest.json" "application/json"

Write-Host "`n=== Released! ===" -ForegroundColor Green
Write-Host $release.html_url
