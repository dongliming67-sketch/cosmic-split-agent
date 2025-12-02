# Cosmic Split Agent V6 - Windows deployment script
# Steps: install dependencies -> build client -> run server with PM2

$ErrorActionPreference = "Stop"
$scriptPath = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $scriptPath

function Write-Step($message) {
    Write-Host ""
    Write-Host "== $message =="
}

function Ensure-Command($cmd) {
    & cmd.exe /c $cmd
    if ($LASTEXITCODE -ne 0) {
        throw "Command failed: $cmd"
    }
}

Write-Host "Starting Windows deployment for Cosmic Split Agent V6"

Write-Step "Step 1 - check Node.js"
try {
    $nodeVersion = node -v
    Write-Host "Node.js version: $nodeVersion"
} catch {
    throw "Node.js not found. Install LTS from https://nodejs.org/ and rerun."
}

Write-Step "Step 2 - install root dependencies"
if (-not (Test-Path "$scriptPath\node_modules")) {
    Ensure-Command "npm install"
} else {
    Write-Host "Root node_modules already exists"
}

Write-Step "Step 3 - install client dependencies"
if (-not (Test-Path "$scriptPath\client\node_modules")) {
    Push-Location "$scriptPath\client"
    try {
        Ensure-Command "npm install"
    } finally {
        Pop-Location
    }
} else {
    Write-Host "Client node_modules already exists"
}

Write-Step "Step 4 - ensure .env"
if (-not (Test-Path "$scriptPath\.env")) {
    if (Test-Path "$scriptPath\.env.example") {
        Copy-Item "$scriptPath\.env.example" "$scriptPath\.env"
        Write-Host "Created .env from template. Update keys and rerun."
        exit 0
    } else {
        throw ".env is missing. Create it with OPENAI_API_KEY and rerun."
    }
} else {
    Write-Host ".env exists"
}

Write-Step "Step 5 - build client"
Ensure-Command "npm run build"

Write-Step "Step 6 - ensure PM2"
$pm2Exists = Get-Command pm2 -ErrorAction SilentlyContinue
if (-not $pm2Exists) {
    Write-Host "Installing pm2 globally"
    Ensure-Command "npm install -g pm2"
}
$env:NODE_ENV = "production"

Write-Step "Step 7 - start service"
try {
    pm2 delete cosmic-v6-prod | Out-Null
} catch {}
pm2 start "$scriptPath\server\index.js" --name cosmic-v6-prod --cwd "$scriptPath" --time --log-date-format "yyyy-MM-dd HH:mm:ss"
if ($LASTEXITCODE -ne 0) {
    throw "pm2 start failed"
}
pm2 save | Out-Null

Write-Host ""
Write-Host "Deployment completed"
$port = if ($env:PORT) { $env:PORT } else { 3001 }
Write-Host "Service URL: http://<your-host>:$port"
Write-Host "Run 'pm2 startup powershell' once (as admin) so pm2 restarts on boot"

Write-Host ""
Write-Host "PM2 quick commands:"
Write-Host "  pm2 status"
Write-Host "  pm2 logs cosmic-v6-prod"
Write-Host "  pm2 restart cosmic-v6-prod"
Write-Host "  pm2 delete cosmic-v6-prod"
