// Configurar colores de gráficos acordes al CSS
const colors = {
    temp: { border: '#e53e3e', bg: 'rgba(229, 62, 62, 0.2)' },
    lluvia: { border: '#3182ce', bg: 'rgba(49, 130, 206, 0.5)' },
    radmax: { border: '#dd6b20', bg: 'rgba(221, 107, 32, 0.5)' },
    presmb: { border: '#38a169', bg: 'rgba(56, 161, 105, 0.2)' }
};

let globalData = [];
let charts = {};
let availableDays = [];
let currentDayIndex = 0;
let customMonthKey = '';

// Configuración de diagnóstico temporal
const DEBUG_DATES = true;
const EXPECTED_MIN_YEAR = 2013;
const EXPECTED_MAX_YEAR = new Date().getFullYear() + 1;
const MAX_ANOMALIES_TO_LOG = 50;

// Utilidades
function normalizeHeaderKey(h) {
    return (h || '')
        .toString()
        .replace(/^\uFEFF/, '')
        .trim()
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');
}

function isDateOutOfExpectedRange(d) {
    if (!(d instanceof Date) || isNaN(d.getTime())) return true;
    const y = d.getFullYear();
    return y < EXPECTED_MIN_YEAR || y > EXPECTED_MAX_YEAR;
}

function debugDateSummary(rows, anomalies) {
    if (!DEBUG_DATES) return;

    const validDates = rows.map(r => r.date).filter(d => d instanceof Date && !isNaN(d.getTime()));
    const years = validDates.map(d => d.getFullYear());

    const minDate = validDates.length ? new Date(Math.min(...validDates.map(d => d.getTime()))) : null;
    const maxDate = validDates.length ? new Date(Math.max(...validDates.map(d => d.getTime()))) : null;

    console.group('Diagnóstico de fechas CSV');
    console.log('Total filas válidas:', rows.length);
    console.log('Año mínimo detectado:', years.length ? Math.min(...years) : 'N/A');
    console.log('Año máximo detectado:', years.length ? Math.max(...years) : 'N/A');
    console.log('Fecha mínima detectada:', minDate ? minDate.toISOString() : 'N/A');
    console.log('Fecha máxima detectada:', maxDate ? maxDate.toISOString() : 'N/A');
    console.log('Anomalías:', anomalies.length);

    if (anomalies.length) {
        console.table(anomalies.slice(0, MAX_ANOMALIES_TO_LOG));
        if (anomalies.length > MAX_ANOMALIES_TO_LOG) {
            console.warn(`Se muestran ${MAX_ANOMALIES_TO_LOG} de ${anomalies.length} anomalías.`);
        }
    }

    console.groupEnd();
}

// Parseo de fecha robusto
function parseDate(dateStr) {
    if (!dateStr) return null;

    const raw = dateStr.toString().trim().replace(/^\uFEFF/, '');
    if (!raw) return null;

    // Formato principal esperado: dd/mm/yyyy hh:mm[:ss] [am|pm|a.m.|p.m.]
    // También soporta dd-mm-yyyy y yyyy-mm-dd
    const m1 = raw.match(
        /^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([ap]\.?m?\.?)?$/i
    );

    const m2 = raw.match(
        /^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([ap]\.?m?\.?)?$/i
    );

    let day, month, year, hour, minute, second = 0, ampm = '';

    if (m1) {
        day = parseInt(m1[1], 10);
        month = parseInt(m1[2], 10);
        const yearToken = m1[3];
        year = parseInt(yearToken, 10);
        hour = parseInt(m1[4], 10);
        minute = parseInt(m1[5], 10);
        second = m1[6] ? parseInt(m1[6], 10) : 0;
        ampm = (m1[7] || '').toLowerCase().replace(/\./g, '');

        if (yearToken.length === 2) year = 2000 + year;
    } else if (m2) {
        year = parseInt(m2[1], 10);
        month = parseInt(m2[2], 10);
        day = parseInt(m2[3], 10);
        hour = parseInt(m2[4], 10);
        minute = parseInt(m2[5], 10);
        second = m2[6] ? parseInt(m2[6], 10) : 0;
        ampm = (m2[7] || '').toLowerCase().replace(/\./g, '');
    } else {
        return null;
    }

    if ([day, month, year, hour, minute, second].some(v => isNaN(v))) return null;

    if (ampm.startsWith('p') && hour < 12) hour += 12;
    if (ampm.startsWith('a') && hour === 12) hour = 0;

    const d = new Date(year, month - 1, day, hour, minute, second, 0);

    // Validación de rollover de fecha (evita 32/01 o mes 13)
    if (
        d.getFullYear() !== year ||
        d.getMonth() !== (month - 1) ||
        d.getDate() !== day
    ) return null;

    // Regla de negocio para este dataset
    if (isDateOutOfExpectedRange(d)) return null;

    return d;
}

function parseNum(numStr) {
    if (numStr === null || numStr === undefined || numStr === '') return 0;
    const clean = numStr.toString().trim().replace(/\./g, '').replace(/,/g, '.');
    const val = parseFloat(clean);
    return isNaN(val) ? 0 : val;
}

function getFechaFromRow(row, metaInfo) {
    const keys = Object.keys(row || {});
    const normalizedMap = {};
    keys.forEach(k => {
        normalizedMap[normalizeHeaderKey(k)] = k;
    });

    // Prioridad por nombre semántico
    const candidates = ['fecha', 'fechahora', 'fecha_hora', 'fecha hora', 'datetime', 'date'];
    for (const c of candidates) {
        if (normalizedMap[c]) return row[normalizedMap[c]];
    }

    // Fallback fuerte por índice: cols[1] (según lo que reportaste)
    if (metaInfo && Array.isArray(metaInfo.rawFields) && metaInfo.rawFields.length > 1) {
        const fieldAt1 = metaInfo.rawFields[1];
        if (fieldAt1 in row) return row[fieldAt1];
    }

    // Último fallback por valor posicional
    const vals = Object.values(row);
    if (vals.length > 1) return vals[1];

    return '';
}

// Cargar y procesar CSV
function loadData() {
    Papa.parse(csvRawData, {
        header: true,
        delimiter: ';',
        skipEmptyLines: true,
        transformHeader: h => h.replace(/^\uFEFF/, '').trim(),
        complete: function(results) {
            const rawFields = (results.meta && results.meta.fields) ? results.meta.fields.slice() : [];
            const metaInfo = { rawFields };

            if (DEBUG_DATES) {
                console.group('Meta CSV');
                console.log('Headers detectados:', rawFields);
                console.log('Primeras 3 filas crudas:', results.data.slice(0, 3));
                console.groupEnd();
            }

            const anomalies = [];
            const parsedRows = results.data.map((row, index) => {
                const fechaRaw = getFechaFromRow(row, metaInfo);
                const parsedDate = parseDate(fechaRaw);

                if (DEBUG_DATES && !parsedDate) {
                    anomalies.push({
                        row: index + 1,
                        tipo: 'fecha_invalida_o_fuera_rango',
                        fechaRaw
                    });
                }

                return {
                    date: parsedDate,
                    temp: parseNum(row.temp),
                    lluvia: parseNum(row.lluvia),
                    radmax: parseNum(row.radmax) * 60,
                    presmb: parseNum(row.presmb)
                };
            });

            globalData = parsedRows.filter(r => r.date !== null);

            debugDateSummary(globalData, anomalies);

            // Si por nombre no está leyendo variables, intentar fallback por coincidencia flexible
            if (globalData.length > 0 && globalData.every(r => r.temp === 0 && r.lluvia === 0 && r.radmax === 0 && r.presmb === 0)) {
                console.warn('Posible desalineación de columnas numéricas. Revisa encabezados reales del CSV.');
            }

            // Extraer días únicos usando día meteorológico (inicio 07:00)
            const daysSet = new Set();
            globalData.forEach(r => {
                const { dayKey } = getMeteoKeys(r.date);
                daysSet.add(dayKey);
            });

            availableDays = Array.from(daysSet).sort().map(dayKey => ({
                dayKey,
                label: formatMeteoDayLabel(dayKey)
            }));

            // Mostrar primer día disponible para evitar desplazamientos
            currentDayIndex = 0;

            updateDashboard('hora');

            const daySelector = document.getElementById('hourly-day-selector');
            const monthInput = document.getElementById('custom-month');
            if (daySelector && monthInput && availableDays.length > 0) {
                daySelector.value = availableDays[currentDayIndex].dayKey;
                daySelector.min = availableDays[0].dayKey;
                daySelector.max = availableDays[availableDays.length - 1].dayKey;
                monthInput.value = availableDays[currentDayIndex].dayKey.substring(0, 7);
                customMonthKey = monthInput.value;
            }
        }
    });
}

// Clave de día meteorológico
function getMeteoKeys(d) {
    const meteoDate = new Date(d);
    if (d.getHours() < 7) {
        meteoDate.setDate(meteoDate.getDate() - 1);
    }

    const dayKey = `${meteoDate.getFullYear()}-${String(meteoDate.getMonth() + 1).padStart(2, '0')}-${String(meteoDate.getDate()).padStart(2, '0')}`;
    const monthKey = `${meteoDate.getFullYear()}-${String(meteoDate.getMonth() + 1).padStart(2, '0')}`;
    const yearKey = `${meteoDate.getFullYear()}`;
    const hourKey = `${dayKey} ${String(d.getHours()).padStart(2, '0')}:00`;

    return { dayKey, monthKey, yearKey, hourKey };
}

function formatMeteoDayLabel(dayKey) {
    const parts = dayKey.split('-').map(Number);
    const start = new Date(parts[0], parts[1] - 1, parts[2], 7, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    end.setHours(6, 59, 0, 0);

    const formatDate = d => `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
    return `${formatDate(start)} 07:00 - ${formatDate(end)} 06:59`;
}

// Agregación de datos
function aggregateData(data, period, customFilter = {}) {
    const byHour = {};

    data.forEach(row => {
        const d = row.date;
        const { dayKey, monthKey, yearKey, hourKey } = getMeteoKeys(d);

        if (!byHour[hourKey]) {
            byHour[hourKey] = {
                key: hourKey, dayKey, monthKey, yearKey,
                tempSum: 0, tempCount: 0, tempMax: -Infinity, tempMin: Infinity,
                lluviaSum: 0, radmaxSum: 0, presmbSum: 0, presmbCount: 0
            };
        }

        const g = byHour[hourKey];
        g.tempSum += row.temp;
        g.tempCount += 1;
        if (row.temp > g.tempMax) g.tempMax = row.temp;
        if (row.temp < g.tempMin) g.tempMin = row.temp;
        g.lluviaSum += row.lluvia;
        g.radmaxSum += row.radmax;
        g.presmbSum += row.presmb;
        g.presmbCount += 1;
    });

    const hourlyList = Object.values(byHour).map(g => ({
        key: g.key,
        dayKey: g.dayKey,
        monthKey: g.monthKey,
        yearKey: g.yearKey,
        hourLabel: g.key.split(' ')[1],
        hourValue: Number(g.key.split(' ')[1].split(':')[0]),
        tempAvg: g.tempCount > 0 ? g.tempSum / g.tempCount : 0,
        tempMax: g.tempMax === -Infinity ? 0 : g.tempMax,
        tempMin: g.tempMin === Infinity ? 0 : g.tempMin,
        lluvia: g.lluviaSum,
        radmax: g.radmaxSum,
        presmbAvg: g.presmbCount > 0 ? g.presmbSum / g.presmbCount : 0
    }));

    if (period === 'hora') {
        const currentDay = availableDays[currentDayIndex];
        const filtered = hourlyList.filter(g => g.dayKey === (currentDay ? currentDay.dayKey : ''));
        return formatResult(filtered, false, true);
    }

    const byDay = {};
    hourlyList.forEach(row => {
        if (!byDay[row.dayKey]) {
            byDay[row.dayKey] = {
                key: row.dayKey, monthKey: row.monthKey, yearKey: row.yearKey,
                tempSum: 0, tempCount: 0, tempMax: -Infinity, tempMin: Infinity,
                lluviaSum: 0, radmaxSum: 0, presmbSum: 0, presmbCount: 0
            };
        }

        const g = byDay[row.dayKey];
        g.tempSum += row.tempAvg;
        g.tempCount += 1;
        if (row.tempMax > g.tempMax) g.tempMax = row.tempMax;
        if (row.tempMin < g.tempMin) g.tempMin = row.tempMin;
        g.lluviaSum += row.lluvia;
        g.radmaxSum += row.radmax;
        g.presmbSum += row.presmbAvg;
        g.presmbCount += 1;
    });

    const dailyList = Object.values(byDay).map(g => ({
        key: g.key,
        monthKey: g.monthKey,
        yearKey: g.yearKey,
        tempAvg: g.tempCount > 0 ? g.tempSum / g.tempCount : 0,
        tempMax: g.tempMax === -Infinity ? 0 : g.tempMax,
        tempMin: g.tempMin === Infinity ? 0 : g.tempMin,
        lluvia: g.lluviaSum,
        radmax: g.radmaxSum,
        presmbAvg: g.presmbCount > 0 ? g.presmbSum / g.presmbCount : 0
    }));

    const byMonth = {};
    dailyList.forEach(row => {
        if (!byMonth[row.monthKey]) {
            byMonth[row.monthKey] = {
                key: row.monthKey, yearKey: row.yearKey,
                tempSum: 0, tempCount: 0, tempMax: -Infinity, tempMin: Infinity,
                lluviaSum: 0, radmaxSum: 0, radmaxCount: 0, presmbSum: 0, presmbCount: 0
            };
        }

        const g = byMonth[row.monthKey];
        g.tempSum += row.tempAvg;
        g.tempCount += 1;
        if (row.tempMax > g.tempMax) g.tempMax = row.tempMax;
        if (row.tempMin < g.tempMin) g.tempMin = row.tempMin;
        g.lluviaSum += row.lluvia;
        g.radmaxSum += row.radmax;
        g.radmaxCount += 1;
        g.presmbSum += row.presmbAvg;
        g.presmbCount += 1;
    });

    const monthlyList = Object.values(byMonth).map(g => ({
        key: g.key,
        yearKey: g.yearKey,
        tempAvg: g.tempCount > 0 ? g.tempSum / g.tempCount : 0,
        tempMax: g.tempMax === -Infinity ? 0 : g.tempMax,
        tempMin: g.tempMin === Infinity ? 0 : g.tempMin,
        lluvia: g.lluviaSum,
        radmax: g.radmaxCount > 0 ? g.radmaxSum / g.radmaxCount : 0,
        presmbAvg: g.presmbCount > 0 ? g.presmbSum / g.presmbCount : 0
    }));

    if (period === 'custom' && customFilter.monthKey) {
        const parts = customFilter.monthKey.split('-').map(Number);
        const y = parts[0];
        const m = parts[1];
        const daysInMonth = new Date(y, m, 0).getDate();

        const dailyMap = Object.fromEntries(dailyList.map(d => [d.key, d]));
        const fullDays = [];

        for (let day = 1; day <= daysInMonth; day++) {
            const dayKey = `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
            if (dailyMap[dayKey]) {
                fullDays.push(dailyMap[dayKey]);
            } else {
                fullDays.push({
                    key: dayKey,
                    monthKey: customFilter.monthKey,
                    yearKey: String(y),
                    tempAvg: 0,
                    tempMax: 0,
                    tempMin: 0,
                    lluvia: 0,
                    radmax: 0,
                    presmbAvg: 0
                });
            }
        }

        return formatResult(fullDays, true);
    }

    if (period === 'mes') return formatResult(monthlyList);

    if (period === 'custom' && customFilter.dayKey) {
        const filtered = hourlyList.filter(g => g.dayKey === customFilter.dayKey);
        return formatResult(filtered);
    }

    const byYear = {};
    monthlyList.forEach(row => {
        if (!byYear[row.yearKey]) {
            byYear[row.yearKey] = {
                key: row.yearKey,
                tempSum: 0, tempCount: 0, tempMax: -Infinity, tempMin: Infinity,
                lluviaSum: 0, radmaxSum: 0, radmaxCount: 0, presmbSum: 0, presmbCount: 0
            };
        }

        const g = byYear[row.yearKey];
        g.tempSum += row.tempAvg;
        g.tempCount += 1;
        if (row.tempMax > g.tempMax) g.tempMax = row.tempMax;
        if (row.tempMin < g.tempMin) g.tempMin = row.tempMin;
        g.lluviaSum += row.lluvia;
        g.radmaxSum += row.radmax;
        g.radmaxCount += 1;
        g.presmbSum += row.presmbAvg;
        g.presmbCount += 1;
    });

    const yearlyList = Object.values(byYear).map(g => ({
        key: g.key,
        tempAvg: g.tempCount > 0 ? g.tempSum / g.tempCount : 0,
        tempMax: g.tempMax === -Infinity ? 0 : g.tempMax,
        tempMin: g.tempMin === Infinity ? 0 : g.tempMin,
        lluvia: g.lluviaSum,
        radmax: g.radmaxCount > 0 ? g.radmaxSum / g.radmaxCount : 0,
        presmbAvg: g.presmbCount > 0 ? g.presmbSum / g.presmbCount : 0
    }));

    return formatResult(yearlyList);

    function formatResult(list, dayOnly = false, useHourLabel = false) {
        if (useHourLabel) {
            list.sort((a, b) => {
                const aHour = a.hourValue >= 0 ? (a.hourValue < 7 ? a.hourValue + 24 : a.hourValue) : a.hourValue;
                const bHour = b.hourValue >= 0 ? (b.hourValue < 7 ? b.hourValue + 24 : b.hourValue) : b.hourValue;
                return aHour - bHour;
            });
        } else {
            list.sort((a, b) => a.key.localeCompare(b.key));
        }

        const res = { labels: [], tempAvg: [], tempMax: [], tempMin: [], lluvia: [], radmax: [], presmb: [] };

        list.forEach(item => {
            if (dayOnly) {
                const parts = item.key.split('-');
                if (parts.length === 3) {
                    res.labels.push(String(Number(parts[2])));
                } else {
                    res.labels.push(item.key);
                }
            } else if (useHourLabel && item.hourLabel) {
                res.labels.push(item.hourLabel);
            } else {
                res.labels.push(item.key);
            }

            res.tempAvg.push(Number(item.tempAvg).toFixed(2));
            res.tempMax.push(Number(item.tempMax).toFixed(2));
            res.tempMin.push(Number(item.tempMin).toFixed(2));
            res.lluvia.push(Number(item.lluvia).toFixed(2));
            res.radmax.push(Number(item.radmax).toFixed(2));
            res.presmb.push(Number(item.presmbAvg).toFixed(2));
        });

        return res;
    }
}

// Crear/Actualizar Gráficos
function renderChart(id, type, labels, datasetsConfig) {
    const ctx = document.getElementById(id).getContext('2d');

    if (charts[id]) {
        charts[id].destroy();
    }

    Chart.defaults.font.family = "'Inter', sans-serif";
    Chart.defaults.color = '#718096';

    charts[id] = new Chart(ctx, {
        type: type,
        data: {
            labels: labels,
            datasets: datasetsConfig
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: true, position: 'top' },
                tooltip: {
                    backgroundColor: 'rgba(45, 55, 72, 0.9)',
                    titleFont: { size: 13 },
                    bodyFont: { size: 14, weight: 'bold' },
                    padding: 10,
                    cornerRadius: 8,
                    displayColors: false
                }
            },
            scales: {
                x: {
                    grid: { display: false, drawBorder: false },
                    ticks: { maxTicksLimit: 10 }
                },
                y: {
                    grid: { color: '#e2e8f0', borderDash: [5, 5], drawBorder: false }
                }
            }
        }
    });
}

function updateDashboard(period) {
    const paginationControls = document.getElementById('pagination-controls');
    const selectionControls = document.getElementById('selection-controls');

    if (period === 'custom') {
        selectionControls.classList.remove('hidden');
        paginationControls.classList.add('hidden');
    } else {
        selectionControls.classList.add('hidden');
        if (period === 'hora') {
            paginationControls.classList.remove('hidden');
            const currentDay = availableDays[currentDayIndex];
            if (currentDay) {
                document.getElementById('hourly-day-selector').value = currentDay.dayKey;
            }
        } else {
            paginationControls.classList.add('hidden');
        }
    }

    const aggData = aggregateData(globalData, period, period === 'custom' ? getCurrentCustomFilter() : {});

    renderChart('chart-temp', 'line', aggData.labels, [
        { label: 'Máxima (°C)', data: aggData.tempMax, borderColor: '#c53030', backgroundColor: 'transparent', borderWidth: 2, tension: 0.4, pointRadius: 2, pointHoverRadius: 5, fill: false },
        { label: 'Promedio (°C)', data: aggData.tempAvg, borderColor: colors.temp.border, backgroundColor: colors.temp.bg, borderWidth: 2, tension: 0.4, pointRadius: 3, pointHoverRadius: 6, fill: true },
        { label: 'Mínima (°C)', data: aggData.tempMin, borderColor: '#2b6cb0', backgroundColor: 'transparent', borderWidth: 2, tension: 0.4, pointRadius: 2, pointHoverRadius: 5, fill: false }
    ]);

    renderChart('chart-lluvia', 'bar', aggData.labels, [
        { label: 'Lluvia Acumulada (mm)', data: aggData.lluvia, borderColor: colors.lluvia.border, backgroundColor: colors.lluvia.bg, borderWidth: 2 }
    ]);

    renderChart('chart-radmax', 'bar', aggData.labels, [
        { label: 'Radiación Acum. (kw/hr/m2)', data: aggData.radmax, borderColor: colors.radmax.border, backgroundColor: colors.radmax.bg, borderWidth: 2 }
    ]);

    renderChart('chart-presmb', 'line', aggData.labels, [
        { label: 'Presión Promedio (mb)', data: aggData.presmb, borderColor: colors.presmb.border, backgroundColor: colors.presmb.bg, borderWidth: 2, tension: 0.4, pointRadius: 3, pointHoverRadius: 6, fill: true }
    ]);
}

// Event Listeners
document.querySelectorAll('.time-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
        document.querySelectorAll('.time-btn').forEach(b => b.classList.remove('active'));
        e.target.classList.add('active');
        const period = e.target.getAttribute('data-period');
        updateDashboard(period);
    });
});

document.getElementById('btn-apply-selection').addEventListener('click', () => {
    customMonthKey = document.getElementById('custom-month').value;
    if (!customMonthKey) {
        alert('Seleccione un mes para mostrar los gráficos.');
        return;
    }
    updateDashboard('custom');
});

const hourlyDaySelector = document.getElementById('hourly-day-selector');
if (hourlyDaySelector) {
    ['input', 'change'].forEach(eventType => {
        hourlyDaySelector.addEventListener(eventType, (e) => {
            const selectedDay = e.target.value;
            const dayIndex = availableDays.findIndex(d => d.dayKey === selectedDay);
            if (dayIndex !== -1) {
                currentDayIndex = dayIndex;
                updateDashboard('hora');
            }
        });
    });
}

function getCurrentCustomFilter() {
    customMonthKey = document.getElementById('custom-month').value;
    return { dayKey: '', monthKey: customMonthKey };
}

// Init
window.onload = loadData;