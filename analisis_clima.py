import pandas as pd
import matplotlib.pyplot as plt
import os

# Configuración de estilo
plt.style.use('bmh')

# Ruta del archivo
file_path = 'lib07_horarios_historico.csv'

# Leer el archivo CSV
df = pd.read_csv(
    file_path,
    sep=';',
    decimal=',',
    thousands='.'
)

# Extraer solo la fecha (los primeros 10 caracteres del campo fecha DD/MM/YYYY)
df['fecha_dia'] = df['fecha'].str[:10]

# Convertir a datetime para poder ordenar cronológicamente
df['fecha_dia'] = pd.to_datetime(df['fecha_dia'], format='%d/%m/%Y')

# Agrupar por fecha y calcular lo solicitado:
# - temp promedio
# - lluvia acumulada (suma)
# - radmax acumulada (suma)
# - presmb promedio diaria
df_diario = df.groupby('fecha_dia').agg({
    'temp': 'mean',
    'lluvia': 'sum',
    'radmax': 'sum',
    'presmb': 'mean'
}).reset_index()

# Multiplicar radiación por 60 como se solicitó
df_diario['radmax'] = df_diario['radmax'] * 60

# Ordenar por fecha
df_diario = df_diario.sort_values('fecha_dia')

# Crear la figura y los subgráficos
fig, axes = plt.subplots(4, 1, figsize=(12, 16), sharex=True)

# 1. Temperatura Promedio
axes[0].plot(df_diario['fecha_dia'], df_diario['temp'], marker='o', color='tab:red', linewidth=2)
axes[0].set_title('Temperatura Promedio Diaria (°C)', fontsize=14)
axes[0].set_ylabel('Temperatura (°C)')

# 2. Lluvia Acumulada
axes[1].bar(df_diario['fecha_dia'], df_diario['lluvia'], color='tab:blue', alpha=0.7)
axes[1].set_title('Lluvia Acumulada Diaria (mm)', fontsize=14)
axes[1].set_ylabel('Precipitación (mm)')

# 3. Radiación Acumulada
axes[2].bar(df_diario['fecha_dia'], df_diario['radmax'], color='tab:orange', alpha=0.7)
axes[2].set_title('Radiación Máxima Acumulada Diaria (kw/hr/m2)', fontsize=14)
axes[2].set_ylabel('Radiación (kw/hr/m2)')

# 4. Presión Promedio
axes[3].plot(df_diario['fecha_dia'], df_diario['presmb'], marker='o', color='tab:green', linewidth=2)
axes[3].set_title('Presión Promedio Diaria (mb)', fontsize=14)
axes[3].set_ylabel('Presión (mb)')
axes[3].set_xlabel('Fecha')

# Formatear el eje X para que las fechas se vean bien
plt.xticks(rotation=45)
plt.tight_layout()

# Guardar la gráfica en una imagen
output_file = 'grafico_resumen_diario.png'
plt.savefig(output_file, dpi=300)
print(f"Proceso completado. Gráfica guardada en: {output_file}")
