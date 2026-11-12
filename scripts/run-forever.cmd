@echo off
setlocal EnableExtensions
cd /d "%~dp0.."

set /a FAILS=0

:loop
node src/index.js
set "CODE=%ERRORLEVEL%"

if "%CODE%"=="0" goto :clean
if "%CODE%"=="2" goto :noconfig
if "%CODE%"=="3" goto :session

set /a FAILS+=1
if %FAILS% GEQ 4 goto :giveup

echo.
echo [%date% %time%] Bot thoat voi code %CODE% - thu lai sau 10 giay (%FAILS%/4)...
"%SystemRoot%\System32\PING.EXE" -n 11 127.0.0.1 >nul
goto :loop

:session
echo.
echo [%date% %time%] Session het han - bot se chay lai sau 5 phut...
set /a FAILS=0
"%SystemRoot%\System32\PING.EXE" -n 301 127.0.0.1 >nul
goto :loop

:clean
echo.
echo [%date% %time%] Bot dung binh thuong - khong khoi dong lai.
exit /b 0

:giveup
echo.
echo [%date% %time%] Bot loi 4 lan lien tiep - dung tu khoi dong lai.
echo Kiem tra token / log roi chay lai file nay.
pause
exit /b 1

:noconfig
echo.
echo [%date% %time%] Thieu token hoac config.json hong - dung tu khoi dong lai.
echo Them token trong web panel / tokens.txt roi chay lai file nay.
"%SystemRoot%\System32\PING.EXE" -n 11 127.0.0.1 >nul
exit /b 1
