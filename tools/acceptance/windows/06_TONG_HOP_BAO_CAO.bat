@echo off
setlocal
title Buoc 06 - Tong hop bao cao nghiem thu
echo ==================================================================
echo  BUOC 06: TONG HOP BAO CAO NGHIEM THU
echo ==================================================================
call "%~dp0_chung.bat"
if errorlevel 1 goto :loi
%PY% "%TOOL%" tong-hop
if errorlevel 1 goto :loi
echo.
echo ===== BUOC 06 DAT. Da lap bao cao: %NGHIEMTHU_DIR%\BAO_CAO_NGHIEM_THU.html =====
goto :dung
:loi
echo.
echo ===== BUOC 06 CHUA DAT. Ket luan chua DAT. Xem file BAO_CAO_NGHIEM_THU.html de biet ly do. =====
:dung
echo Ket qua va log: %NGHIEMTHU_DIR%
echo.
pause
endlocal
