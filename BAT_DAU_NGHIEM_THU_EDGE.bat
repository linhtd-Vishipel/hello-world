@echo off
rem Mo thu muc chua 6 file BAT nghiem thu Microsoft Edge.
if not exist "%~dp0tools\acceptance\windows\01_KIEM_TRA_MOI_TRUONG.bat" goto :thieu
start "" explorer "%~dp0tools\acceptance\windows"
echo Da mo thu muc: %~dp0tools\acceptance\windows
echo Bam dup lan luot 01_KIEM_TRA_MOI_TRUONG.bat den 06_TONG_HOP_BAO_CAO.bat.
echo Xem ket qua: bam dup MO_THU_MUC_KET_QUA.bat trong thu muc do.
goto :dung
:thieu
echo Khong thay thu muc tools\acceptance\windows canh file nay.
echo Hay giai nen day du ma nguon roi chay lai.
:dung
echo.
pause
