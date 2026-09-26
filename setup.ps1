$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
if (-not (Test-Path '.venv\Scripts\python.exe')) {
    $pythonCommand = 'python'
    $pythonArgs = @()
    if (Get-Command py -ErrorAction SilentlyContinue) {
        & py -3.10 --version 2>$null | Out-Null
        if ($LASTEXITCODE -eq 0) {
            $pythonCommand = 'py'
            $pythonArgs = @('-3.10')
        }
    }
    & $pythonCommand @pythonArgs -m venv .venv
    if ($LASTEXITCODE -ne 0) { throw '無法建立 Python 虛擬環境' }
}
& .\.venv\Scripts\python.exe -m pip install -r requirements.txt
if ($LASTEXITCODE -ne 0) { throw 'Python 套件安裝失敗' }
& .\.venv\Scripts\python.exe build_ui.py
if ($LASTEXITCODE -ne 0) { throw 'Web 介面建置失敗' }
& .\.venv\Scripts\python.exe download_model.py
if ($LASTEXITCODE -ne 0) { throw '語音模型下載失敗' }
Write-Output '完成。執行 start.bat 即可使用。'
