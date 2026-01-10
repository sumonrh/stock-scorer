document.addEventListener('DOMContentLoaded', () => {
    fetchEtfs();
    fetchHoldings();

    document.getElementById('refresh-etfs').addEventListener('click', fetchEtfs);
    document.getElementById('refresh-holdings').addEventListener('click', fetchHoldings);
});

async function fetchEtfs() {
    const tableBody = document.querySelector('#etf-table tbody');
    tableBody.innerHTML = '<tr><td colspan="6" class="loading-text">Updating...</td></tr>';

    try {
        const response = await fetch('/api/etfs');
        const data = await response.json();
        renderEtfTable(data);
    } catch (e) {
        tableBody.innerHTML = `<tr><td colspan="6" class="loading-text" style="color:var(--danger)">Error: ${e.message}</td></tr>`;
    }
}

async function fetchHoldings() {
    const tableBody = document.querySelector('#holdings-table tbody');
    tableBody.innerHTML = '<tr><td colspan="7" class="loading-text">Scanning Top Holdings...</td></tr>';

    try {
        const response = await fetch('/api/holdings');
        const data = await response.json();
        renderHoldingsTable(data);
    } catch (e) {
        tableBody.innerHTML = `<tr><td colspan="7" class="loading-text" style="color:var(--danger)">Error: ${e.message}</td></tr>`;
    }
}

function renderEtfTable(data) {
    const tbody = document.querySelector('#etf-table tbody');
    tbody.innerHTML = '';

    if (data.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="loading-text">No data found</td></tr>';
        return;
    }

    data.forEach(item => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><strong>${item.ticker}</strong></td>
            <td>${getScoreBadge(item['Quant Score'])}</td>
            <td>${item.price}</td>
            <td class="${getColorClass(item.percentChange)}">${item.percentChange}%</td>
            <td>${item.RVol}</td>
            <td class="${getColorClass(item['%Pred'])}">${item['%Pred']}%</td>
        `;
        tbody.appendChild(tr);
    });
}

function renderHoldingsTable(data) {
    const tbody = document.querySelector('#holdings-table tbody');
    tbody.innerHTML = '';

    if (data.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="loading-text">No data found</td></tr>';
        return;
    }

    data.forEach(item => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><strong>${item.ticker}</strong></td>
            <td>${getScoreBadge(item['Quant Score'])}</td>
            <td>${item.price}</td>
            <td class="${getColorClass(item.percentChange)}">${item.percentChange}%</td>
            <td>${item.RVol}</td>
            <td class="${getColorClass(item['%Pred'])}">${item['%Pred']}%</td>
            <td>${item.squeezeStatus !== 'No' ? '⚠️' : ''}</td>
        `;
        tbody.appendChild(tr);
    });
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
