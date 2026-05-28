@echo off
echo ================================
echo   Dashboard Climatico - Inicio
echo ================================
echo.
echo Actualizando datos desde GitHub...
python "%~dp0actualizar_datos.py"
echo.
echo Abriendo dashboard...
start "" "%~dp0index.html"
