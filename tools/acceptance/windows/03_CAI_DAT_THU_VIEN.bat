@echo off
setlocal
title Buoc 03 - Cai dat thu vien
echo ==================================================================
echo  BUOC 03: CAI DAT THU VIEN
echo ==================================================================
call "%~dp0_chung.bat"
if errorlevel 1 goto :loi
%PY% "%TOOL%" cai-dat
if errorlevel 1 goto :loi
echo.
echo ===== BUOC 03 DAT. Tiep theo: mo file 01_KIEM_TRA_MOI_TRUONG.bat de xac nhan, roi 04_KIEM_THU_EDGE.bat =====
goto :dung
:loi
echo.
echo ===== BUOC 03 CHUA DAT. Doc thong bao loi o tren, xu ly xong chay lai file nay. =====
:dung
echo Ket qua va log: %NGHIEMTHU_DIR%
echo.
pause
endlocal
