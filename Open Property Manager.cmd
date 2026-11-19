@echo off
powershell.exe -NoLogo -NoProfile -ExecutionPolicy RemoteSigned -File "%~dp0Start-PropertyManager.ps1"
if errorlevel 1 pause
