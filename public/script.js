// ... existing code ...

const SWING_THRESHOLDS = { calm: 15, caution: 20, high: 30 };
const DAY_THRESHOLDS = { calm: -5, caution: 5, high: 10 };

async function fetchVixStatus() {
    try {
        const response = await fetch('/api/vix-status');
        const data = await response.json();

        if (data && data.price) {
            updateVixIndicators(data);
        }
    } catch (e) {
        console.error("Failed to fetch VIX status", e);
    }
}

function updateVixIndicators(vixData) {
    const isMarketOpen = checkMarketOpen(); // Use valid check

    // --- Swing Logic ---
    let swingLabel = 'Neutral';
    let swingColor = 'status-gray';
    const level = vixData.price;

    if (level > SWING_THRESHOLDS.high) { swingLabel = 'High Risk'; swingColor = 'status-red'; }
    else if (level > SWING_THRESHOLDS.caution) { swingLabel = 'Caution'; swingColor = 'status-orange'; }
    else if (level < SWING_THRESHOLDS.calm) { swingLabel = 'Calm'; swingColor = 'status-green'; }

    // Update Swing UI
    const swingEl = document.getElementById('swing-indicator');
    swingEl.querySelector('.status-icon').setAttribute('class', `status-icon ${swingColor}`);
    document.getElementById('swing-label').textContent = swingLabel;
    document.getElementById('swing-label').className = `font-bold ${swingColor}`; // Apply color to text too
    document.getElementById('swing-vix').textContent = `VIX: ${level.toFixed(2)}`;

    // --- Day Logic ---
    let dayLabel = 'Neutral';
    let dayColor = 'status-gray';
    let dayDetail = 'Updates during market hours';

    if (isMarketOpen) {
        const roc = ((level - vixData.open) / vixData.open) * 100;

        // Dynamic Thresholds
        const scale = level > SWING_THRESHOLDS.high ? 1.2 : 1.0;
        const calmRoc = DAY_THRESHOLDS.calm * scale;
        const highRoc = DAY_THRESHOLDS.high * scale;

        if (roc < calmRoc) { dayLabel = 'Volatility Easing'; dayColor = 'status-green'; }
        else if (roc > highRoc) { dayLabel = 'Rapid Spike'; dayColor = 'status-red'; }
        else if (roc > 0) { dayLabel = 'Volatility Rising'; dayColor = 'status-orange'; }

        dayDetail = `VIX ROC: ${roc.toFixed(2)}%`;
    } else {
        dayLabel = 'Market Closed';
    }

    // Update Day UI
    const dayEl = document.getElementById('day-indicator');
    dayEl.querySelector('.status-icon').setAttribute('class', `status-icon ${dayColor}`);
    document.getElementById('day-label').textContent = dayLabel;
    document.getElementById('day-label').className = `font-bold ${dayColor}`;
    document.getElementById('day-detail').textContent = dayDetail;
}

function checkMarketOpen() {
    // Basic Client-Side Check (Time Zone aware)
    // Note: Replicating server logic for immediate UI updates
    const now = new Date();
    const etString = now.toLocaleString("en-US", { timeZone: "America/New_York" });
    const etDate = new Date(etString);

    const day = etDate.getDay();
    const hour = etDate.getHours();
    const minute = etDate.getMinutes(); // Fixed variable name to match server logic structure
    const minutesOfDay = (hour * 60) + minute;

    if (day === 0 || day === 6) return false;
    // 9:30 (570) to 16:00 (960)
    return minutesOfDay >= 570 && minutesOfDay < 960;
}

document.addEventListener('DOMContentLoaded', () => {
    // ... existing initialization ...
    fetchVixStatus();
    setInterval(fetchVixStatus, 60000); // Poll every minute

    // ... existing listeners ...
    // Event Listeners
    document.getElementById('refresh-etfs').addEventListener('click', fetchEtfs);
    document.getElementById('refresh-holdings').addEventListener('click', fetchHoldings);
    document.getElementById('refresh-movers').addEventListener('click', fetchMovers);

    // Initial Load
    fetchEtfs();
    fetchHoldings();
    fetchMovers();
});


// State
let etfData = [];
let holdingsData = [];
let moversData = { open: [], closed: [] };
let currentMoverMode = 'open'; // 'open' | 'closed'

let sortState = {
    etf: { key: 'Quant Score', dir: 'desc' },
    holdings: { key: 'Quant Score', dir: 'desc' }
};

async function fetchEtfs() {
    const tableBody = document.querySelector('#etf-table tbody');
    tableBody.innerHTML = '<tr><td colspan="7" class="loading-text">Updating...</td></tr>';

    try {
        const response = await fetch('/api/etfs');
        etfData = await response.json();
        // Initial Sort
        sortData(etfData, sortState.etf.key, sortState.etf.dir);
        renderEtfTable(etfData);
    } catch (e) {
        tableBody.innerHTML = `<tr><td colspan="7" class="loading-text" style="color:var(--danger)">Error: ${e.message}</td></tr>`;
    }
}

async function fetchHoldings() {
    const tableBody = document.querySelector('#holdings-table tbody');
    tableBody.innerHTML = '<tr><td colspan="13" class="loading-text">Scanning Top Holdings...</td></tr>';

    try {
        const response = await fetch('/api/holdings');
        holdingsData = await response.json();
        // Initial Sort
        sortData(holdingsData, sortState.holdings.key, sortState.holdings.dir);
        renderHoldingsTable(holdingsData);
    } catch (e) {
        tableBody.innerHTML = `<tr><td colspan="13" class="loading-text" style="color:var(--danger)">Error: ${e.message}</td></tr>`;
    }
}

async function fetchMovers() {
    const tableBody = document.querySelector('#movers-table tbody');
    tableBody.innerHTML = '<tr><td colspan="9" class="loading-text">Finding Top Movers...</td></tr>';

    try {
        const response = await fetch('/api/movers');
        moversData = await response.json();
        renderMoversTable();
    } catch (e) {
        tableBody.innerHTML = `<tr><td colspan="9" class="loading-text" style="color:var(--danger)">Error: ${e.message}</td></tr>`;
    }
}

// Sorting Logic
function sortData(data, key, dir) {
    data.sort((a, b) => {
        let valA = a[key];
        let valB = b[key];

        // Handle special columns or missing logic if needed
        if (typeof valA === 'string' && valA.endsWith('x')) valA = parseFloat(valA);
        if (typeof valB === 'string' && valB.endsWith('x')) valB = parseFloat(valB);

        if (valA < valB) return dir === 'asc' ? -1 : 1;
        if (valA > valB) return dir === 'asc' ? 1 : -1;
        return 0;
    });
}

function handleSort(type, key) {
    const state = sortState[type];
    if (state.key === key) {
        state.dir = state.dir === 'asc' ? 'desc' : 'asc';
    } else {
        state.key = key;
        state.dir = 'desc'; // Default desccending for most metrics
    }

    // Update Icons (Simple text based for now)
    document.querySelectorAll(`#${type}-table th`).forEach(th => {
        th.querySelector('.sort-icon').textContent = '';
        if (th.dataset.sort === key) {
            th.querySelector('.sort-icon').textContent = state.dir === 'asc' ? '▲' : '▼';
        }
    });

    if (type === 'etf') {
        sortData(etfData, state.key, state.dir);
        renderEtfTable(etfData);
    } else {
        sortData(holdingsData, state.key, state.dir);
        renderHoldingsTable(holdingsData);
    }
}

// Add Click Listeners
document.querySelectorAll('#etf-table th[data-sort]').forEach(th => {
    th.addEventListener('click', () => handleSort('etf', th.dataset.sort));
});

document.querySelectorAll('#holdings-table th[data-sort]').forEach(th => {
    th.addEventListener('click', () => handleSort('holdings', th.dataset.sort));
});




// ... fetch functions (already added logic for movers in previous step, keep existing fetch logic) ...
// But I need to allow "fetchMovers" to exist if I replaced it?
// Wait, I am replacing the document ready block at top AND render functions at bottom?
// replace_file_content targets a contiguous block.
// I will just update the render functions now.

function renderEtfTable(data) {
    const tbody = document.querySelector('#etf-table tbody');
    tbody.innerHTML = '';

    if (data.length === 0) {
        tbody.innerHTML = '<tr><td colspan="13" class="loading-text">No data found</td></tr>';
        return;
    }

    data.forEach(item => {
        const tr = document.createElement('tr');
        tr.innerHTML = generateRowHtml(item);
        tbody.appendChild(tr);
    });
}

function renderHoldingsTable(data) {
    const tbody = document.querySelector('#holdings-table tbody');
    tbody.innerHTML = '';

    if (data.length === 0) {
        tbody.innerHTML = '<tr><td colspan="13" class="loading-text">No data found</td></tr>';
        return;
    }

    data.forEach(item => {
        const tr = document.createElement('tr');
        tr.innerHTML = generateRowHtml(item);
        tbody.appendChild(tr);
    });
}

async function fetchMovers() {
    const tableBody = document.querySelector('#movers-table tbody');
    tableBody.innerHTML = '<tr><td colspan="9" class="loading-text">Finding Top Movers...</td></tr>';

    try {
        const response = await fetch('/api/movers');
        const result = await response.json();

        moversData = result.data;
        currentMarketStatus = result.status; // 'OPEN' or 'CLOSED'

        renderMoversTable();
    } catch (e) {
        console.error(e);
        tableBody.innerHTML = `<tr><td colspan="9" class="loading-text" style="color:var(--danger)">Error: ${e.message}</td></tr>`;
    }
}



// ... (Sort logic remains same) ...

function renderMoversTable() {
    const tbody = document.querySelector('#movers-table tbody');
    const thead = document.querySelector('#movers-table thead tr');
    const title = document.getElementById('movers-title');

    tbody.innerHTML = '';

    // Update Header based on Status
    if (currentMarketStatus === 'OPEN') {
        title.textContent = "Top Market Movers (Remaining Potential)";
        title.innerHTML += ' <span style="font-size:0.7em; color:var(--success); margin-left:10px;">● MARKET OPEN</span>';

        thead.innerHTML = `
            <th>Ticker</th>
            <th>Quant Score</th>
            <th>Price</th>
            <th>% Chg</th>
            <th>RVol</th>
            <th>% Pred</th>
            <th>Potential</th>
            <th>RS(x)</th>
            <th>Squeeze</th>
        `;
    } else {
        title.textContent = "Top Gainers (Overview)";
        title.innerHTML += ' <span style="font-size:0.7em; color:var(--text-muted); margin-left:10px;">● MARKET CLOSED</span>';

        // Hide Prediction columns for Closed market
        thead.innerHTML = `
            <th>Ticker</th>
            <th>Quant Score</th>
            <th>Price</th>
            <th>% Chg</th>
            <th>RVol</th>
            <!-- Hidden Pred/Potential -->
            <th>RS(x)</th>
            <th>Squeeze</th>
        `;
    }

    if (!moversData || moversData.length === 0) {
        const cols = (currentMarketStatus === 'OPEN') ? 9 : 7;
        tbody.innerHTML = `<tr><td colspan="${cols}" class="loading-text">No movers found matching criteria.</td></tr>`;
        return;
    }

    moversData.forEach(item => {
        const tr = document.createElement('tr');

        let rowContent = `
            <td><strong>${item.ticker}</strong></td>
            <td>${getScoreBadge(item['Quant Score'])}</td>
            <td>${item.price}</td>
            <td class="${getColorClass(item.percentChange)}">${item.percentChange}%</td>
            <td>${item.RVol}</td>
        `;

        if (currentMarketStatus === 'OPEN') {
            const potential = (item['%Pred'] - item.percentChange).toFixed(2);
            rowContent += `
                <td class="${getColorClass(item['%Pred'])}">${Number(item['%Pred']).toFixed(2)}%</td>
                <td class="${getColorClass(Number(potential))}">${potential}%</td>
            `;
        }

        rowContent += `
            <td><span class="rank-badge">${Number(item['RS Rating']).toFixed(2)}x</span></td>
            <td><span class="${getSqueezeClass(item.squeezeStatus)}">${item.squeezeStatus}</span></td>
        `;

        tr.innerHTML = rowContent;
        tbody.appendChild(tr);
    });
}

function generateRowHtml(item) {
    return `
        <td><strong>${item.ticker}</strong></td>
        <td>${getScoreBadge(item['Quant Score'])}</td>
        <td>${item.price}</td>
        <td class="${getColorClass(item.percentChange)}">${item.percentChange}%</td>
        <td>${item.RVol}</td>
        <td class="${getColorClass(item['%Pred'])}">${Number(item['%Pred']).toFixed(2)}%</td>
        
        <td><span class="rank-badge">${Number(item['RS Rating']).toFixed(2)}x</span></td>
        
        <td>${item.atr}</td>
        <td>${item.percentADR}%</td>
        
        <td>${item['10EMA (ATR)']}x</td>
        <td>${item['20EMA (ATR)']}x</td>
        <td>${item['50EMA (ATR)']}x</td>
        
        <td><span class="${getSqueezeClass(item.squeezeStatus)}">${item.squeezeStatus}</span></td>
    `;
}

function getScoreBadge(score) {
    let cls = 'score-low';
    if (score >= 80) cls = 'score-high';
    else if (score >= 50) cls = 'score-mid';

    return `<span class="score-badge ${cls}">${score}</span>`;
}

function getColorClass(val) {
    if (val > 0) return 'pos-change';
    if (val < 0) return 'neg-change';
    return '';
}

function getSqueezeClass(status) {
    if (status === 'High') return 'squeeze-high';
    if (status === 'Medium') return 'squeeze-med';
    if (status === 'Low') return 'squeeze-low';
    return 'squeeze-no';
}
