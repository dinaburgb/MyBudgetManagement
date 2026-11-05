@echo off
REM Double-click me with Claude Desktop CLOSED (tray icon included).
REM Adds the MyBudget MCP server to Claude Desktop's config.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0add-mcp-to-claude-desktop.ps1"
echo.
pause
