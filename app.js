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

// Funciones de parseo
function parseDate(dateStr) {
    if (!dateStr) return null;
    let parts = dateStr.trim().split(' ');
    if (parts.length < 3) return null;
    let dmy = parts[0].split('/');
    let hm = parts[1].split(':');
    let ampm = parts[2].toLowerCase();
    
    let day = parseInt(dmy[0], 10);
    let month = parseInt(dmy[1], 10) - 1;
    let year = parseInt(dmy[2], 10);
    
    let hour = parseInt(hm[0], 10);
    let minute = parseInt(hm[1], 10);
    
    if ((ampm.includes('p') || ampm.includes('m')) && ampm !== 'a.m.' && hour < 12) hour += 12;
    if (ampm.includes('a') && hour === 12) hour = 0;
    
    return new Date(year, month, day, hour, minute);
}

function parseNum(numStr) {
    if (!numStr) return 0;
    let clean = numStr.toString().replace(/\./g, '').replace(/,/g, '.');
    let val = parseFloat(clean);
    return isNaN(val) ? 0 : val;
}

// Cargar y procesar CSV
function loadData() {
    Papa.parse(csvRawData, {
        header: true,
        delimiter: ';',
        skipEmptyLines: true,
        complete: function(results) {
            globalData = results.data.map(row => {
                return {
                    date: parseDate(row.fecha),
                    temp: parseNum(row.temp),
                    lluvia: parseNum(row.lluvia),
                    // Multiplicar radiación por 60
                    radmax: parseNum(row.radmax) * 60,
                    presmb: parseNum(row.presmb)
                };
            }).filter(row => row.date !== null);
            
            // Extraer días únicos usando el día meteorológico (inicio 07:00)
            let daysSet = new Set();
            globalData.forEach(r => {
                let { dayKey } = getMeteoKeys(r.date);
                daysSet.add(dayKey);
            });
            availableDays = Array.from(daysSet).sort().map(dayKey => ({
                dayKey,
                label: formatMeteoDayLabel(dayKey)
            }));
            currentDayIndex = 1; // Iniciar en el segundo día (el primero puede tener datos incompletos)
            
            // Inicializar gráficos por hora (default)
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

// Clave de día meteorológico: el día empieza a las 07:00 y termina a las 06:59 del siguiente día
// Las horas 00:00-06:59 pertenecen al día meteorológico del día anterior
function getMeteoKeys(d) {
    let meteoDate = new Date(d);
    if (d.getHours() < 7) {
        meteoDate.setDate(meteoDate.getDate() - 1);
    }
    let dayKey   = `${meteoDate.getFullYear()}-${String(meteoDate.getMonth()+1).padStart(2,'0')}-${String(meteoDate.getDate()).padStart(2,'0')}`;
    let monthKey = `${meteoDate.getFullYear()}-${String(meteoDate.getMonth()+1).padStart(2,'0')}`;
    let yearKey  = `${meteoDate.getFullYear()}`;
    let hourKey  = `${dayKey} ${String(d.getHours()).padStart(2,'0')}:00`;
    return { dayKey, monthKey, yearKey, hourKey };
}

function formatMeteoDayLabel(dayKey) {
    const parts = dayKey.split('-').map(Number);
    const start = new Date(parts[0], parts[1] - 1, parts[2], 7, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    end.setHours(6, 59, 0, 0);

    const formatDate = d => `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`;
    return `${formatDate(start)} 07:00 - ${formatDate(end)} 06:59`;
}

// Agregación de datos
function aggregateData(data, period, customFilter = {}) {
    // 1. Hourly
    let byHour = {};
    data.forEach(row => {
        let d = row.date;
        let { dayKey, monthKey, yearKey, hourKey } = getMeteoKeys(d);

        if (!byHour[hourKey]) {
            byHour[hourKey] = {
                key: hourKey, dayKey, monthKey, yearKey,
                tempSum: 0, tempCount: 0, tempMax: -Infinity, tempMin: Infinity,
                lluviaSum: 0, radmaxSum: 0, presmbSum: 0, presmbCount: 0
            };
        }
        let g = byHour[hourKey];
        g.tempSum += row.temp;
        g.tempCount += 1;
        if (row.temp > g.tempMax) g.tempMax = row.temp;
        if (row.temp < g.tempMin) g.tempMin = row.temp;
        g.lluviaSum += row.lluvia;
        g.radmaxSum += row.radmax;
        g.presmbSum += row.presmb;
        g.presmbCount += 1;
    });

    let hourlyList = Object.values(byHour).map(g => ({
        key: g.key, dayKey: g.dayKey, monthKey: g.monthKey, yearKey: g.yearKey,
        tempAvg: g.tempCount > 0 ? g.tempSum / g.tempCount : 0,
        tempMax: g.tempMax === -Infinity ? 0 : g.tempMax,
        tempMin: g.tempMin === Infinity ? 0 : g.tempMin,
        lluvia: g.lluviaSum,
        radmax: g.radmaxSum,
        presmbAvg: g.presmbCount > 0 ? g.presmbSum / g.presmbCount : 0
    }));

    

    if (period === 'hora') {
        let currentDay = availableDays[currentDayIndex];
        let filtered = hourlyList.filter(g => g.dayKey === (currentDay ? currentDay.dayKey : ''));
        return formatResult(filtered);
    }

    // 2. Daily
    let byDay = {};
    hourlyList.forEach(row => {
        if (!byDay[row.dayKey]) {
            byDay[row.dayKey] = {
                key: row.dayKey, monthKey: row.monthKey, yearKey: row.yearKey,
                tempSum: 0, tempCount: 0, tempMax: -Infinity, tempMin: Infinity,
                lluviaSum: 0, radmaxSum: 0, presmbSum: 0, presmbCount: 0
            };
        }
        let g = byDay[row.dayKey];
        g.tempSum += row.tempAvg;
        g.tempCount += 1;
        if (row.tempMax > g.tempMax) g.tempMax = row.tempMax;
        if (row.tempMin < g.tempMin) g.tempMin = row.tempMin;
        g.lluviaSum += row.lluvia;
        g.radmaxSum += row.radmax; // Sum for daily
        g.presmbSum += row.presmbAvg;
        g.presmbCount += 1;
    });

    let dailyList = Object.values(byDay).map(g => ({
        key: g.key, monthKey: g.monthKey, yearKey: g.yearKey,
        tempAvg: g.tempCount > 0 ? g.tempSum / g.tempCount : 0,
        tempMax: g.tempMax === -Infinity ? 0 : g.tempMax,
        tempMin: g.tempMin === Infinity ? 0 : g.tempMin,
        lluvia: g.lluviaSum,
        radmax: g.radmaxSum, // Sum of hourly
        presmbAvg: g.presmbCount > 0 ? g.presmbSum / g.presmbCount : 0
    }));

    // 3. Monthly
    let byMonth = {};
    dailyList.forEach(row => {
        if (!byMonth[row.monthKey]) {
            byMonth[row.monthKey] = {
                key: row.monthKey, yearKey: row.yearKey,
                tempSum: 0, tempCount: 0, tempMax: -Infinity, tempMin: Infinity,
                lluviaSum: 0, radmaxSum: 0, radmaxCount: 0, presmbSum: 0, presmbCount: 0
            };
        }
        let g = byMonth[row.monthKey];
        g.tempSum += row.tempAvg;
        g.tempCount += 1;
        if (row.tempMax > g.tempMax) g.tempMax = row.tempMax;
        if (row.tempMin < g.tempMin) g.tempMin = row.tempMin;
        g.lluviaSum += row.lluvia;
        g.radmaxSum += row.radmax; // Average daily for monthly
        g.radmaxCount += 1;
        g.presmbSum += row.presmbAvg;
        g.presmbCount += 1;
    });

    let monthlyList = Object.values(byMonth).map(g => ({
        key: g.key, yearKey: g.yearKey,
        tempAvg: g.tempCount > 0 ? g.tempSum / g.tempCount : 0,
        tempMax: g.tempMax === -Infinity ? 0 : g.tempMax,
        tempMin: g.tempMin === Infinity ? 0 : g.tempMin,
        lluvia: g.lluviaSum,
        radmax: g.radmaxCount > 0 ? g.radmaxSum / g.radmaxCount : 0, // Avg of daily
        presmbAvg: g.presmbCount > 0 ? g.presmbSum / g.presmbCount : 0
    }));

    if (period === 'custom' && customFilter.monthKey) {
        // Para selector por mes: construir la serie diaria completa del mes seleccionado
        const parts = customFilter.monthKey.split('-').map(Number);
        const y = parts[0];
        const m = parts[1]; // 1-12
        const daysInMonth = new Date(y, m, 0).getDate();

        const dailyMap = Object.fromEntries(dailyList.map(d => [d.key, d]));
        const fullDays = [];
        for (let day = 1; day <= daysInMonth; day++) {
            const dayKey = `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
            if (dailyMap[dayKey]) {
                fullDays.push(dailyMap[dayKey]);
            } else {
                fullDays.push({ key: dayKey, monthKey: customFilter.monthKey, yearKey: String(y), tempAvg: 0, tempMax: 0, tempMin: 0, lluvia: 0, radmax: 0, presmbAvg: 0 });
            }
        }
        return formatResult(fullDays, true);
    }

    if (period === 'mes') return formatResult(monthlyList);

    if (period === 'custom' && customFilter.dayKey) {
        let filtered = hourlyList.filter(g => g.dayKey === customFilter.dayKey);
        return formatResult(filtered);
    }

    // 4. Yearly
    let byYear = {};
    monthlyList.forEach(row => {
        if (!byYear[row.yearKey]) {
            byYear[row.yearKey] = {
                key: row.yearKey,
                tempSum: 0, tempCount: 0, tempMax: -Infinity, tempMin: Infinity,
                lluviaSum: 0, radmaxSum: 0, radmaxCount: 0, presmbSum: 0, presmbCount: 0
            };
        }
        let g = byYear[row.yearKey];
        g.tempSum += row.tempAvg;
        g.tempCount += 1;
        if (row.tempMax > g.tempMax) g.tempMax = row.tempMax;
        if (row.tempMin < g.tempMin) g.tempMin = row.tempMin;
        g.lluviaSum += row.lluvia;
        g.radmaxSum += row.radmax; // Average monthly for yearly
        g.radmaxCount += 1;
        g.presmbSum += row.presmbAvg;
        g.presmbCount += 1;
    });

    let yearlyList = Object.values(byYear).map(g => ({
        key: g.key,
        tempAvg: g.tempCount > 0 ? g.tempSum / g.tempCount : 0,
        tempMax: g.tempMax === -Infinity ? 0 : g.tempMax,
        tempMin: g.tempMin === Infinity ? 0 : g.tempMin,
        lluvia: g.lluviaSum,
        radmax: g.radmaxCount > 0 ? g.radmaxSum / g.radmaxCount : 0, // Avg of monthly
        presmbAvg: g.presmbCount > 0 ? g.presmbSum / g.presmbCount : 0
    }));

    return formatResult(yearlyList);

    function formatResult(list, dayOnly = false) {
        // Sort by key
        list.sort((a, b) => a.key.localeCompare(b.key));
        
        let res = { labels: [], tempAvg: [], tempMax: [], tempMin: [], lluvia: [], radmax: [], presmb: [] };
        list.forEach(item => {
            if (dayOnly) {
                // item.key expected format YYYY-MM-DD -> show day number without leading zeros
                const parts = item.key.split('-');
                if (parts.length === 3) {
                    res.labels.push(String(Number(parts[2])));
                } else {
                    res.labels.push(item.key);
                }
            } else {
                res.labels.push(item.key);
            }
            res.tempAvg.push(item.tempAvg.toFixed(2));
            res.tempMax.push(item.tempMax.toFixed(2));
            res.tempMin.push(item.tempMin.toFixed(2));
            res.lluvia.push(item.lluvia.toFixed(2));
            res.radmax.push(item.radmax.toFixed(2));
            res.presmb.push(item.presmbAvg.toFixed(2));
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
    
    // Default config Chart.js
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
            const selectedDay = e.target.value; // YYYY-MM-DD format
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
