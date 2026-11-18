@echo off
setlocal
title M02 - Doi chieu file Excel xuat voi file nguon
echo ==================================================================
echo  M02: DOI CHIEU FILE EXCEL XUAT VOI FILE EXCEL NGUON
echo  Dung cho moi file Excel: so sheet, so dong, so cot bat ky.
echo  Chi doc file, khong sua file nguon va file xuat.
echo ==================================================================
call "%~dp0_chung.bat"
set "MA=%ERRORLEVEL%"
if not "%MA%"=="0" goto :loi
%PY% "%TOOL%" doi-chieu-excel
set "MA=%ERRORLEVEL%"
if not "%MA%"=="0" goto :loi
echo.
echo ===== M02 PHAN TU DONG DAT. Con kiem bang mat trong Microsoft Excel, roi nhap ket qua M02 o buoc 06. =====
goto :dung
:loi
echo.
echo ===== M02 CHUA DAT - ma thoat %MA%. Xem chi tiet: %NGHIEMTHU_DIR%\thu_cong\m02_doi_chieu_excel.md =====
:dung
echo.
pause
endlocal & exit /b %MA%
