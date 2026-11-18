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
rem Uu tien cac phien ban Python da chay thu, roi den ban moi nhat, roi den python.exe.
rem Moi lua chon deu duoc chay thu, nen loi tat python gia cua Microsoft Store bi loai.
set "PY="
py -3.13 -c "import sys" >nul 2>&1
if not errorlevel 1 set "PY=py -3.13"
if defined PY goto :co_python
py -3.12 -c "import sys" >nul 2>&1
if not errorlevel 1 set "PY=py -3.12"
if defined PY goto :co_python
py -3.11 -c "import sys" >nul 2>&1
if not errorlevel 1 set "PY=py -3.11"
if defined PY goto :co_python
py -3 -c "import sys" >nul 2>&1
if not errorlevel 1 set "PY=py -3"
if defined PY goto :co_python
python -c "import sys" >nul 2>&1
if not errorlevel 1 set "PY=python"
if defined PY goto :co_python
echo.
echo [LOI] Khong tim thay Python tren may.
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
