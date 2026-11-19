@echo off
setlocal
title Mo thu muc ket qua nghiem thu
if not defined NGHIEMTHU_DIR set "NGHIEMTHU_DIR=C:\nghiemthu\edge"
if not exist "%NGHIEMTHU_DIR%\" goto :chua_co_thu_muc
start "" explorer "%NGHIEMTHU_DIR%"
if exist "%NGHIEMTHU_DIR%\BAO_CAO_NGHIEM_THU.html" goto :co_bao_cao
echo Da mo thu muc: %NGHIEMTHU_DIR%
echo.
echo CHUA CO file BAO_CAO_NGHIEM_THU.html.
echo File bao cao chi duoc tao khi chay xong buoc 06_TONG_HOP_BAO_CAO.bat.
echo Hay chay lan luot 01, 02, 03, 04, 05, 06 trong thu muc chua file nay.
goto :dung
:co_bao_cao
start "" "%NGHIEMTHU_DIR%\BAO_CAO_NGHIEM_THU.html"
echo Da mo bao cao: %NGHIEMTHU_DIR%\BAO_CAO_NGHIEM_THU.html
goto :dung
:chua_co_thu_muc
echo CHUA CO thu muc ket qua: %NGHIEMTHU_DIR%
echo Thu muc nay duoc tao tu dong khi ban chay 01_KIEM_TRA_MOI_TRUONG.bat lan dau.
echo Dang mo thu muc chua 6 file BAT - hay bam dup 01_KIEM_TRA_MOI_TRUONG.bat truoc.
start "" explorer "%~dp0"
:dung
echo.
pause
endlocal
