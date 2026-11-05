<#
    Adds the MyBudget MCP server to Claude Desktop's config.

    WHY A SCRIPT: Claude Desktop keeps mcpServers in the same file as its own
    preferences, and it rewrites that file from memory while it runs — an edit
    made with the app open is silently lost on quit. Run this with Claude
    Desktop fully CLOSED (including the tray icon), then start it.

    Safe to run twice: if the server is already there, nothing is written.
    Everything else in the file (other MCP servers, all preferences) is kept
    exactly as it was; a .bak copy is made before any write.

    Usage:
        powershell -ExecutionPolicy Bypass -File scripts\add-mcp-to-claude-desktop.ps1
    or just double-click add-mcp-to-claude-desktop.bat next to it.
#>
param(
    # Override for testing. Normally found automatically.
    [string]$ConfigPath = '',
    # Where this repo lives, in case it was moved.
    [string]$RepoRoot = '',
    # Skip the "Claude Desktop is running" prompt (used by tests).
    [switch]$Force
)

$ErrorActionPreference = 'Stop'

function Fail($msg) { Write-Host "`n  $msg`n" -ForegroundColor Red; exit 1 }
function Ok($msg)   { Write-Host "  $msg" -ForegroundColor Green }
function Info($msg) { Write-Host "  $msg" }

Write-Host "`n=== MyBudget -> Claude Desktop (MCP) ===`n" -ForegroundColor Cyan

# --- 1. Is Claude Desktop running? -----------------------------------------
$running = Get-Process -Name 'Claude' -ErrorAction SilentlyContinue
if ($running -and -not $Force) {
    Write-Host "  Claude Desktop is still running." -ForegroundColor Yellow
    Write-Host "  Close it completely first - including the tray icon next to the"
    Write-Host "  clock (right-click -> Quit). Otherwise it will overwrite this change"
    Write-Host "  when it exits.`n"
    $answer = Read-Host "  Continue anyway? (y/N)"
    if ($answer -ne 'y') { Info 'Stopped. Nothing was changed.'; exit 0 }
}

# --- 2. Find the repo and the server file ----------------------------------
if (-not $RepoRoot) { $RepoRoot = Split-Path -Parent $PSScriptRoot }
$serverJs = Join-Path $RepoRoot 'myfinance\server\mcp\server.js'
if (-not (Test-Path $serverJs)) { Fail "MCP server not found at: $serverJs`n  Pass -RepoRoot <path to MyBudgetManagement>." }

# --- 3. Find node ----------------------------------------------------------
$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) {
    foreach ($candidate in @("$env:ProgramFiles\nodejs\node.exe", "${env:ProgramFiles(x86)}\nodejs\node.exe", "$env:LOCALAPPDATA\Programs\nodejs\node.exe")) {
        if (Test-Path $candidate) { $node = $candidate; break }
    }
}
if (-not $node) { Fail 'node.exe not found. Install Node.js, or add it to PATH.' }

# --- 4. Find Claude Desktop's config ---------------------------------------
# The Microsoft Store build redirects its user data out of AppData\Roaming,
# so check the redirected folders too. Most recently written wins.
if (-not $ConfigPath) {
    $candidates = @()
    $candidates += Join-Path $env:APPDATA 'Claude\claude_desktop_config.json'
    $dataRoot = Join-Path $env:LOCALAPPDATA 'Claude-Data'
    if (Test-Path $dataRoot) {
        $candidates += (Get-ChildItem $dataRoot -Directory -ErrorAction SilentlyContinue |
                        ForEach-Object { Join-Path $_.FullName 'claude_desktop_config.json' })
    }
    $found = $candidates | Where-Object { Test-Path $_ } |
             Sort-Object { (Get-Item $_).LastWriteTime } -Descending
    if (-not $found) {
        Fail ("claude_desktop_config.json not found. Open Claude Desktop ->`n" +
              "  Settings -> Developer -> Edit Config to see where it lives, then`n" +
              "  re-run this with -ConfigPath <that path>.")
    }
    $ConfigPath = $found[0]
}
if (-not (Test-Path $ConfigPath)) { Fail "Config not found: $ConfigPath" }
Info "config:  $ConfigPath"
Info "node:    $node"
Info "server:  $serverJs"
Write-Host ''

# --- 5. Read it, add the entry, keep everything else -----------------------
$raw = Get-Content -Path $ConfigPath -Raw -Encoding UTF8
try { $cfg = $raw | ConvertFrom-Json } catch { Fail "That file is not valid JSON, so it was left alone:`n  $($_.Exception.Message)" }

if ($cfg.PSObject.Properties.Name -notcontains 'mcpServers') {
    $cfg | Add-Member -MemberType NoteProperty -Name 'mcpServers' -Value ([PSCustomObject]@{})
}
if ($cfg.mcpServers.PSObject.Properties.Name -contains 'mybudget') {
    Ok 'mybudget is already in the config - nothing to do.'
    Info 'If the tools still do not show up, restart Claude Desktop completely.'
    exit 0
}

# Forward slashes: valid in JSON and in Node on Windows, and no escaping traps.
$entry = [PSCustomObject]@{
    command = $node.Replace('\', '/')
    args    = @($serverJs.Replace('\', '/'))
}
$cfg.mcpServers | Add-Member -MemberType NoteProperty -Name 'mybudget' -Value $entry

$backup = "$ConfigPath.bak-" + (Get-Date -Format 'yyyy-MM-dd-HHmmss')
Copy-Item -Path $ConfigPath -Destination $backup
Info "backup:  $backup"

$json = $cfg | ConvertTo-Json -Depth 100
# ConvertTo-Json escapes forward slashes in some PowerShell versions; undo that.
# (literal string Replace, not -replace: a lone backslash is not a valid regex)
$json = $json.Replace('\/', '/')
[System.IO.File]::WriteAllText($ConfigPath, $json, (New-Object System.Text.UTF8Encoding($false)))

# --- 6. Verify what was written --------------------------------------------
$check = Get-Content -Path $ConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json
if ($check.mcpServers.PSObject.Properties.Name -notcontains 'mybudget') { Fail "Write did not take. The backup is at:`n  $backup" }

Ok ('done. MCP servers in the config: ' + (($check.mcpServers.PSObject.Properties.Name) -join ', '))
Write-Host ''
Info 'Now start Claude Desktop and ask it: how much money do we have right now?'
Write-Host ''
