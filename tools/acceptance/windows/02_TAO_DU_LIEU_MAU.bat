@echo off
setlocal
title Buoc 02 - Tao du lieu mau
echo ==================================================================
echo  BUOC 02: TAO DU LIEU MAU
echo ==================================================================
call "%~dp0_chung.bat"
if errorlevel 1 goto :loi
%PY% "%TOOL%" tao-du-lieu
if errorlevel 1 goto :loi
echo.
echo ===== BUOC 02 DAT. Tiep theo: mo file 03_CAI_DAT_THU_VIEN.bat =====
goto :dung
:loi
echo.
echo ===== BUOC 02 CHUA DAT. Doc thong bao loi o tren, xu ly xong chay lai file nay. =====
:dung
echo Ket qua va log: %NGHIEMTHU_DIR%
echo.
pause
endlocal
