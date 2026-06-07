$ErrorActionPreference = 'Stop'

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$Clasp = Join-Path $env:APPDATA 'npm\clasp.cmd'
$MainSpreadsheetId = '1WE1MrG0TJ9rEA3nRVEMGF-lpakzLqTUSeSG05b8RN7Y'
$MainProjectTitle = 'All in one Zendesk Report'

Set-Location $ProjectRoot
$env:PATH = 'C:\Program Files\nodejs;' + $env:APPDATA + '\npm;' + $env:PATH

if (-not (Test-Path $Clasp)) {
  throw "clasp was not found at $Clasp. Install it with: npm.cmd install -g @google/clasp"
}

function Invoke-Clasp {
  param([Parameter(ValueFromRemainingArguments = $true)][string[]] $Arguments)
  & $Clasp @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "clasp $($Arguments -join ' ') failed with exit code $LASTEXITCODE"
  }
}

function Get-ClaspAccessToken {
  Invoke-Clasp list | Out-Null
  $clasprcPath = Join-Path $env:USERPROFILE '.clasprc.json'
  return (Get-Content -Raw $clasprcPath | ConvertFrom-Json).tokens.default.access_token
}

function Invoke-GoogleJson {
  param(
    [Parameter(Mandatory = $true)][string] $Method,
    [Parameter(Mandatory = $true)][string] $Url,
    [object] $Body = $null
  )

  $headers = @{
    Authorization  = 'Bearer ' + (Get-ClaspAccessToken)
    'Content-Type' = 'application/json; charset=utf-8'
  }

  if ($null -eq $Body) {
    return Invoke-RestMethod -Uri $Url -Headers $headers -Method $Method
  }

  $jsonBody = $Body | ConvertTo-Json -Depth 8 -Compress
  return Invoke-RestMethod -Uri $Url -Headers $headers -Method $Method -Body $jsonBody
}

function Test-CurrentScriptContentAccess {
  if (-not (Test-Path '.clasp.json')) {
    return $false
  }

  $scriptId = (Get-Content -Raw '.clasp.json' | ConvertFrom-Json).scriptId
  if (-not $scriptId) {
    return $false
  }

  try {
    Invoke-GoogleJson -Method Get -Url "https://script.googleapis.com/v1/projects/$scriptId/content" | Out-Null
    return $true
  } catch {
    Write-Host "Current .clasp.json scriptId is not accessible through the Apps Script content API."
    return $false
  }
}

function New-BoundScriptIfNeeded {
  if (Test-CurrentScriptContentAccess) {
    Write-Host 'Current .clasp.json is accessible. Reusing it.'
    return
  }

  $backupPath = Join-Path $ProjectRoot ('.clasp.backup.' + (Get-Date -Format 'yyyyMMddHHmmss') + '.json')
  if (Test-Path '.clasp.json') {
    Move-Item '.clasp.json' $backupPath -Force
    Write-Host "Backed up old .clasp.json to $backupPath"
  }

  try {
    $project = Invoke-GoogleJson -Method Post -Url 'https://script.googleapis.com/v1/projects' -Body @{
      title    = $MainProjectTitle
      parentId = $MainSpreadsheetId
    }

    @{
      scriptId = $project.scriptId
      rootDir  = './apps-script'
    } | ConvertTo-Json | Set-Content -Path '.clasp.json' -Encoding utf8

    Write-Host "Created bound Apps Script project: $($project.scriptId)"
  } catch {
    if ((Test-Path $backupPath) -and -not (Test-Path '.clasp.json')) {
      Move-Item $backupPath '.clasp.json' -Force
    }
    throw
  }
}

function Publish-AppsScriptContent {
  $scriptId = (Get-Content -Raw '.clasp.json' | ConvertFrom-Json).scriptId
  $files = New-Object System.Collections.ArrayList

  Get-ChildItem 'apps-script' -File | Sort-Object Name | ForEach-Object {
    $name = [System.IO.Path]::GetFileNameWithoutExtension($_.Name)
    $type = if ($_.Name -eq 'appsscript.json') { 'JSON' } else { 'SERVER_JS' }
    $source = [System.IO.File]::ReadAllText($_.FullName)
    [void]$files.Add([ordered]@{
      name   = $name
      type   = $type
      source = $source
    })
  }

  Invoke-GoogleJson -Method Put -Url "https://script.googleapis.com/v1/projects/$scriptId/content" -Body @{
    files = $files
  } | Out-Null

  Write-Host "Published Apps Script content to $scriptId"
}

function Invoke-ClaspRunOptional {
  param([Parameter(Mandatory = $true)][string] $FunctionName)

  $output = & $Clasp run $FunctionName 2>&1
  $text = ($output | Out-String).Trim()
  if ($text) {
    Write-Host $text
  }

  if ($LASTEXITCODE -ne 0 -or $text -match 'Script function not found|deployed as API executable|Only users in the same domain') {
    throw "Remote Apps Script execution is unavailable for $FunctionName."
  }
}

New-BoundScriptIfNeeded
Publish-AppsScriptContent

Write-Host ''
Write-Host 'Trying remote setup run...'
try {
  Invoke-ClaspRunOptional 'setupProject'
  Invoke-ClaspRunOptional 'inspectAttendanceSource'
  Invoke-ClaspRunOptional 'manualPopulateDaily'
} catch {
  Write-Host ''
  Write-Host 'Remote run was blocked by Google deployment/ownership policy.'
  Write-Host 'Open the Apps Script project and run setupProject() once from the editor, then use the spreadsheet menu.'
}

Write-Host ''
Write-Host 'Opening Apps Script project.'
Invoke-Clasp open-script
