@echo off
setlocal
title Buoc 05 - Doi chieu ket qua
echo ==================================================================
echo  BUOC 05: DOI CHIEU KET QUA
echo ==================================================================
call "%~dp0_chung.bat"
set "MA=%ERRORLEVEL%"
if not "%MA%"=="0" goto :loi
%PY% "%TOOL%" doi-chieu
set "MA=%ERRORLEVEL%"
if not "%MA%"=="0" goto :loi
echo.
echo ===== BUOC 05 DAT. Tiep theo: mo file 06_TONG_HOP_BAO_CAO.bat =====
goto :dung
:loi
echo.
echo ===== BUOC 05 CHUA DAT - ma thoat %MA%. Co bai FAIL hoac thieu dieu kien bat buoc - xem log. Poppler/LibreOffice KHONG bat buoc - thieu thi ghi SKIP. Neu co FAIL: van chay 06. =====
:dung
echo Ket qua va log: %NGHIEMTHU_DIR%
echo.
pause
endlocal & exit /b %MA%
