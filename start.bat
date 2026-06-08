@echo off
chcp 65001 > nul
title 楽天KPI管理システム

set "PYEXE=C:\Users\user\AppData\Local\Python\pythoncore-3.14-64\python.exe"
if not exist "%PYEXE%" set "PYEXE=py -3"

REM --- フロントの依存が無ければ初回だけ自動インストール ---
if not exist "%~dp0frontend\node_modules" (
  echo フロントの初回セットアップ中です。数分かかります...
  pushd "%~dp0frontend"
  call npm install
  popd
)

REM --- 単一インスタンス・ガード -----------------------------------------
REM 既に両サーバーが起動済みなら、再起動もブラウザ起動もしない。
REM （起動済みのまま再実行すると「古いタブ＋新タブ」で二重になるのを防ぐ）
powershell -NoProfile -Command "try{ $null=Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 'http://127.0.0.1:8000/api/health'; $null=Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 'http://127.0.0.1:5173'; exit 0 } catch { exit 1 }"
if %errorlevel% equ 0 (
  echo.
  echo アプリは既に起動しています。
  echo すでに開いているブラウザのタブをご利用ください。
  echo タブが見当たらない場合のみ、手動で http://127.0.0.1:5173 を開いてください。
  echo.
  timeout /t 3 /nobreak > nul
  exit
)

REM --- 念のため :8000 / :5173 を掴んだままの古いプロセスを掃除 ---
powershell -NoProfile -Command "$c=Get-NetTCPConnection -LocalPort 8000,5173 -State Listen -ErrorAction SilentlyContinue; foreach($x in $c){ Stop-Process -Id $x.OwningProcess -Force -ErrorAction SilentlyContinue }"
timeout /t 1 /nobreak > nul

REM --- バックエンド（最小化で起動） ---
start "Backend :8000" /min cmd /k "cd /d %~dp0backend && %PYEXE% -m uvicorn main:app --host 127.0.0.1 --port 8000"

REM --- フロントエンド（最小化で起動） ---
start "Frontend :5173" /min cmd /k "cd /d %~dp0frontend && npm run dev"

echo.
echo サーバーの起動を待っています。準備ができ次第ブラウザが自動で開きます...
echo （初回や再起動直後は10〜20秒ほどかかります）

REM --- 両サーバーの応答を待ってからブラウザを「1回だけ」開く ---
powershell -NoProfile -Command "for($i=0;$i -lt 90;$i++){ try{ $null=Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 'http://127.0.0.1:8000/api/health'; $null=Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 'http://127.0.0.1:5173'; Start-Process 'http://127.0.0.1:5173'; exit 0 } catch { Start-Sleep -Seconds 1 } }; exit 1"

if errorlevel 1 (
  echo.
  echo 起動の確認がタイムアウトしました。
  echo 最小化されている「Backend」「Frontend」のウィンドウでエラーをご確認ください。
  echo それでも開かない場合は、手動で http://127.0.0.1:5173 を開いてください。
  echo.
  pause
)

exit
