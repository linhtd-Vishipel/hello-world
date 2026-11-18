@echo off
setlocal
title Buoc 04 - Kiem thu tu dong tren Microsoft Edge
echo ==================================================================
echo  BUOC 04: KIEM THU TU DONG TREN MICROSOFT EDGE
echo ==================================================================
call "%~dp0_chung.bat"
set "MA=%ERRORLEVEL%"
if not "%MA%"=="0" goto :loi
%PY% "%TOOL%" kiem-thu-edge
set "MA=%ERRORLEVEL%"
if not "%MA%"=="0" goto :loi
echo.
echo ===== BUOC 04 DAT. Tiep theo: mo file 05_DOI_CHIEU_KET_QUA.bat =====
goto :dung
:loi
echo.
echo ===== BUOC 04 CHUA DAT - ma thoat %MA%. Co bai FAIL hoac loi. Van tiep tuc chay 05 va 06 de co bao cao day du. =====
:dung
echo Ket qua va log: %NGHIEMTHU_DIR%
echo.
pause
endlocal & exit /b %MA%
