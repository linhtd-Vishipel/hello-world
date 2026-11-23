@echo off
rem ==================================================================
rem  Thiet lap chung cho bo nghiem thu Edge. KHONG chay truc tiep file nay;
rem  hay mo cac file 01_ ... 06_ theo thu tu.
rem  Ket qua: PY = lenh goi Python, TOOL = duong dan nghiemthu.py,
rem           NGHIEMTHU_DIR = thu muc ket qua. Moi duong dan dua tren vi tri
rem           cua file BAT nay, khong phu thuoc thu muc lam viec hien tai.
rem ==================================================================
chcp 65001 >nul
set "PYTHONUTF8=1"
set "PYTHONIOENCODING=utf-8"
set "PYTHONDONTWRITEBYTECODE=1"
if not defined NGHIEMTHU_DIR set "NGHIEMTHU_DIR=C:\nghiemthu\edge"
set "TOOL=%~dp0..\nghiemthu.py"
if not exist "%TOOL%" goto :thieu_tool
rem Tim Python 3.11 tro len. Thu tu: cac ban da chay thu 3.13, 3.12, 3.11 qua trinh khoi chay py,
rem roi Python 3 moi nhat cua py, roi python.exe, roi python3.exe. Moi lua chon deu duoc
rem chay thu VA kiem tra phien ban: ban cu hon 3.11 bi bo qua, tim tiep lua chon sau;
rem loi tat python gia cua Microsoft Store khong chay duoc nen cung bi bo qua.
set "PY="
set "PY_CU="
set "PY_KIEM_TRA=import sys; sys.exit(0 if sys.version_info >= (3, 11) else 1)"
call :thu_python py -3.13
call :thu_python py -3.12
call :thu_python py -3.11
call :thu_python py -3
call :thu_python python
call :thu_python python3
if defined PY goto :co_python
echo.
if defined PY_CU goto :python_cu
echo [LOI] Khong tim thay Python tren may.
goto :huong_dan_python
:python_cu
echo [LOI] Chi tim thay Python cu hon 3.11: %PY_CU%
echo       Bo nghiem thu can Python 3.11 tro len.
:huong_dan_python
echo       Cai Python 3.12 hoac 3.13 tu https://www.python.org/downloads/windows/
echo       Khi cai, nho danh dau o "Add python.exe to PATH".
echo       Cai xong, dong cua so nay va mo lai file BAT.
exit /b 9009
:thieu_tool
echo.
echo [LOI] Khong thay file nghiemthu.py canh thu muc windows.
echo       Hay giu nguyen cau truc thu muc ma nguon: tools\acceptance\windows\
exit /b 2
:co_python
echo Python: %PY%
exit /b 0

rem ------------------------------------------------------------------
rem  :thu_python LENH   Dat PY=LENH neu LENH chay duoc Python 3.11 tro len
rem  va PY chua co. Python chay duoc nhung cu hon thi ghi vao PY_CU.
rem ------------------------------------------------------------------
:thu_python
if defined PY exit /b 0
%* -c "import sys" >nul 2>&1
if errorlevel 1 exit /b 0
%* -c "%PY_KIEM_TRA%" >nul 2>&1
if errorlevel 1 goto :bo_qua_ban_cu
set "PY=%*"
exit /b 0
:bo_qua_ban_cu
if not defined PY_CU set "PY_CU=%*"
exit /b 0
