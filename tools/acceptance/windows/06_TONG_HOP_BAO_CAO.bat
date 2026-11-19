@echo off
setlocal
title Buoc 06 - Tong hop bao cao nghiem thu
echo ==================================================================
echo  BUOC 06: TONG HOP BAO CAO NGHIEM THU
echo ==================================================================
call "%~dp0_chung.bat"
set "MA=%ERRORLEVEL%"
if not "%MA%"=="0" goto :loi
%PY% "%TOOL%" tong-hop
set "MA=%ERRORLEVEL%"
if not "%MA%"=="0" goto :loi
echo.
echo ===== BUOC 06 DAT. Da lap bao cao: %NGHIEMTHU_DIR%\BAO_CAO_NGHIEM_THU.html =====
goto :dung
:loi
echo.
echo ===== BUOC 06 CHUA DAT - ma thoat %MA%. Ket luan KHONG DAT. Xem ly do trong file BAO_CAO_NGHIEM_THU.html. =====
:dung
echo Ket qua va log: %NGHIEMTHU_DIR%
echo.
pause
endlocal & exit /b %MA%
