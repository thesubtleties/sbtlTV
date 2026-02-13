# Setup mpv development files for Windows
# Run from packages/mpv-texture directory
# Requires: Visual Studio with C++ tools (for dumpbin/lib)

$ErrorActionPreference = "Stop"

$MPV_DEV_URL = "https://github.com/shinchiro/mpv-winbuild-cmake/releases/download/20260122/mpv-dev-x86_64-20260122-git-6e54aa3.7z"
$SCRIPT_DIR = Split-Path -Parent $MyInvocation.MyCommand.Path
$PKG_DIR = Split-Path -Parent $SCRIPT_DIR
$DEPS_DIR = Join-Path $PKG_DIR "deps\mpv"
$WIN64_DIR = Join-Path $DEPS_DIR "win64"
$INCLUDE_DIR = Join-Path $DEPS_DIR "include"
$TEMP_DIR = Join-Path $env:TEMP "mpv-dev-setup"

Write-Host "=== mpv-texture Windows Setup ===" -ForegroundColor Cyan
Write-Host "Package dir: $PKG_DIR"
Write-Host "Deps dir: $DEPS_DIR"

# Create directories
New-Item -ItemType Directory -Force -Path $WIN64_DIR | Out-Null
New-Item -ItemType Directory -Force -Path $INCLUDE_DIR | Out-Null
New-Item -ItemType Directory -Force -Path $TEMP_DIR | Out-Null

# Download mpv-dev SDK
$archivePath = Join-Path $TEMP_DIR "mpv-dev.7z"
if (-not (Test-Path $archivePath)) {
    Write-Host "Downloading mpv-dev SDK..." -ForegroundColor Yellow
    Invoke-WebRequest -Uri $MPV_DEV_URL -OutFile $archivePath
    Write-Host "Downloaded to $archivePath"
} else {
    Write-Host "Using cached archive: $archivePath"
}

# Extract
Write-Host "Extracting..." -ForegroundColor Yellow
$extractDir = Join-Path $TEMP_DIR "extracted"
if (Test-Path $extractDir) {
    Remove-Item -Recurse -Force $extractDir
}
7z x $archivePath -o"$extractDir" -y | Out-Null

# Find the extracted files
$dllPath = Get-ChildItem -Path $extractDir -Recurse -Filter "libmpv-2.dll" | Select-Object -First 1
if (-not $dllPath) {
    Write-Host "ERROR: libmpv-2.dll not found in archive" -ForegroundColor Red
    exit 1
}

$sdkRoot = $dllPath.DirectoryName
Write-Host "SDK root: $sdkRoot"

# Copy DLL
Write-Host "Copying libmpv-2.dll..." -ForegroundColor Yellow
Copy-Item (Join-Path $sdkRoot "libmpv-2.dll") $WIN64_DIR -Force

# Skip copying SDK headers - we use our own minimal headers that are known to work
# The SDK headers use MPV_EXPORT and other macros that can cause build issues
Write-Host "Keeping existing headers (SDK headers skipped for compatibility)" -ForegroundColor Yellow

# Generate mpv.lib from DLL
Write-Host "Generating mpv.lib from DLL exports..." -ForegroundColor Yellow

# Find Visual Studio or Build Tools
$vsWhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
$vcvars = $null

if (Test-Path $vsWhere) {
    $vsPath = & $vsWhere -latest -property installationPath
    if ($vsPath) {
        $vcvars = "$vsPath\VC\Auxiliary\Build\vcvarsall.bat"
        Write-Host "Found Visual Studio: $vsPath"
    }
}

# Try common Build Tools locations if vswhere didn't work
if (-not $vcvars -or -not (Test-Path $vcvars)) {
    $searchPaths = @(
        "${env:ProgramFiles}\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvarsall.bat",
        "${env:ProgramFiles}\Microsoft Visual Studio\2022\Community\VC\Auxiliary\Build\vcvarsall.bat",
        "${env:ProgramFiles}\Microsoft Visual Studio\2022\Professional\VC\Auxiliary\Build\vcvarsall.bat",
        "${env:ProgramFiles}\Microsoft Visual Studio\2022\Enterprise\VC\Auxiliary\Build\vcvarsall.bat",
        "${env:ProgramFiles(x86)}\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvarsall.bat",
        "${env:ProgramFiles(x86)}\Microsoft Visual Studio\2019\BuildTools\VC\Auxiliary\Build\vcvarsall.bat",
        "${env:ProgramFiles(x86)}\Microsoft Visual Studio\2019\Community\VC\Auxiliary\Build\vcvarsall.bat"
    )
    foreach ($path in $searchPaths) {
        if (Test-Path $path) {
            $vcvars = $path
            Write-Host "Found Build Tools: $path"
            break
        }
    }
}

if (-not $vcvars -or -not (Test-Path $vcvars)) {
    Write-Host "ERROR: Visual Studio or Build Tools not found" -ForegroundColor Red
    Write-Host ""
    Write-Host "Install Visual Studio Build Tools:" -ForegroundColor Yellow
    Write-Host "  winget install Microsoft.VisualStudio.2022.BuildTools --override `"--add Microsoft.VisualStudio.Workload.VCTools --includeRecommended --passive`""
    Write-Host ""
    Write-Host "Or install via Visual Studio Installer:" -ForegroundColor Yellow
    Write-Host "  https://visualstudio.microsoft.com/downloads/#build-tools-for-visual-studio-2022"
    exit 1
}

# Export symbols from DLL to .def
$dllFile = Join-Path $WIN64_DIR "libmpv-2.dll"
$defFile = Join-Path $WIN64_DIR "mpv.def"
$libFile = Join-Path $WIN64_DIR "mpv.lib"

$defContent = "LIBRARY libmpv-2`nEXPORTS`n"

# Run dumpbin in VS environment
$dumpCmd = "`"$vcvars`" x64 >nul 2>&1 && dumpbin /exports `"$dllFile`""
$dumpOutput = cmd /c $dumpCmd 2>&1

$exportCount = 0
$dumpOutput | ForEach-Object {
    # Match export lines: ordinal, RVA, hint, name
    if ($_ -match '^\s+\d+\s+[0-9A-Fa-f]+\s+[0-9A-Fa-f]+\s+(\S+)') {
        $defContent += "  $($Matches[1])`n"
        $exportCount++
    }
}

if ($exportCount -eq 0) {
    Write-Host "ERROR: No exports found in DLL" -ForegroundColor Red
    exit 1
}

Write-Host "Found $exportCount exports"
Set-Content -Path $defFile -Value $defContent

# Create .lib from .def
$libCmd = "`"$vcvars`" x64 >nul 2>&1 && lib /def:`"$defFile`" /machine:x64 /out:`"$libFile`""
cmd /c $libCmd 2>&1 | Out-Null

if (Test-Path $libFile) {
    Write-Host "Created: $libFile" -ForegroundColor Green
} else {
    Write-Host "ERROR: Failed to create mpv.lib" -ForegroundColor Red
    exit 1
}

# Verify files
Write-Host "`n=== Setup Complete ===" -ForegroundColor Green
Write-Host "Files in $WIN64_DIR`:"
Get-ChildItem $WIN64_DIR | ForEach-Object { Write-Host "  $_" }
Write-Host "`nHeaders in $INCLUDE_DIR`:"
Get-ChildItem -Recurse $INCLUDE_DIR -Filter "*.h" | ForEach-Object { Write-Host "  $($_.FullName.Replace($INCLUDE_DIR, ''))" }

Write-Host "`nNext steps:" -ForegroundColor Cyan
Write-Host "  1. cd $PKG_DIR"
Write-Host "  2. npm install"
Write-Host "  3. npm run build"
