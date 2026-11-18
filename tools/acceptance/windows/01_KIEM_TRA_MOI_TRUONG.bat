@echo off
setlocal
title Buoc 01 - Kiem tra moi truong
echo ==================================================================
echo  BUOC 01: KIEM TRA MOI TRUONG
echo ==================================================================
call "%~dp0_chung.bat"
set "MA=%ERRORLEVEL%"
if not "%MA%"=="0" goto :loi
%PY% "%TOOL%" kiem-tra
set "MA=%ERRORLEVEL%"
if not "%MA%"=="0" goto :loi
echo.
echo ===== BUOC 01 DAT. Tiep theo: mo file 02_TAO_DU_LIEU_MAU.bat =====
goto :dung
:loi
echo.
echo ===== BUOC 01 CHUA DAT - ma thoat %MA%. Doc cac dong [LOI] va huong dan o tren, xu ly xong chay lai file nay. =====
:dung
echo Ket qua va log: %NGHIEMTHU_DIR%
echo.
pause
endlocal & exit /b %MA%
