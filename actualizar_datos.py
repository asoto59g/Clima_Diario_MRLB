import json
import os
import urllib.request

# URL raw del archivo en GitHub
GITHUB_RAW_URL = 'https://raw.githubusercontent.com/asoto59g/Scraper_Meteo/main/salida_csv/historico/lib07_horarios_historico.csv'

csv_file = 'lib07_horarios_historico.csv'
js_file  = 'data.js'

print("Descargando datos desde GitHub...")
print(f"  -> {GITHUB_RAW_URL}")

try:
    with urllib.request.urlopen(GITHUB_RAW_URL) as response:
        content = response.read().decode('utf-8')

    # Guardar una copia local del CSV
    with open(csv_file, 'w', encoding='utf-8') as f:
        f.write(content)
    print(f"  -> Copia local guardada en: {csv_file}")

    # Generar data.js para el dashboard
    js_content = f"const csvRawData = {json.dumps(content)};\n"
    with open(js_file, 'w', encoding='utf-8') as f:
        f.write(js_content)
    print(f"  -> {js_file} actualizado correctamente.")

    # Mostrar cuántas filas contiene el CSV
    lines = [l for l in content.splitlines() if l.strip()]
    print(f"\n¡Actualización completada! Registros encontrados: {len(lines) - 1} (sin encabezado)")

except urllib.error.URLError as e:
    print(f"\nError de conexión: {e.reason}")
    print("Verifica tu conexión a internet e intenta de nuevo.")
except Exception as e:
    print(f"\nError inesperado: {e}")

