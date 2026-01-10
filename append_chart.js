
// --- CHARTING HELPERS ---

export async function getChartData(ticker) {
    try {
        const endDate = new Date();
        const startDate = new Date();
        startDate.setFullYear(endDate.getFullYear() - 1); // 1 Year of data

        const queryOptions = { period1: startDate, interval: '1d' };
        const result = await yahooFinance.chart(ticker, queryOptions);

        if (!result || !result.quotes || result.quotes.length === 0) {
            return [];
        }

        const data = result.quotes;

        // Calculate Indicators
        const closes = data.map(d => d.close);
        const highs = data.map(d => d.high);
        const lows = data.map(d => d.low);

        const ema10 = calculateEMA(closes, 10);
        const ema20 = calculateEMA(closes, 20);
        const ema50 = calculateEMA(closes, 50);
        const ema200 = calculateEMA(closes, 200);

        // Squeeze Calculations
        const sma20 = calculateSMA(closes, 20);
        const stdDev20 = calculateStdDev(closes, 20, sma20);
        const atr20 = calculateATR(highs, lows, closes, 20);

        return data.map((d, i) => {
            if (!d.date) return null;

            const dateStr = d.date.toISOString().split('T')[0];

            let squeeze = 'No';
            // BB
            const bbUpper = sma20[i] + (2 * stdDev20[i]);
            const bbLower = sma20[i] - (2 * stdDev20[i]);
            // KC
            const kcBasis = ema20[i];
            const kcUpper = kcBasis + (1.5 * atr20[i]);
            const kcLower = kcBasis - (1.5 * atr20[i]);

            if (bbUpper <= kcUpper && bbLower >= kcLower) {
                squeeze = 'High';
            }

            return {
                time: dateStr,
                open: d.open,
                high: d.high,
                low: d.low,
                close: d.close,
                volume: d.volume,
                ema10: ema10[i],
                ema20: ema20[i],
                ema50: ema50[i],
                ema200: ema200[i],
                squeeze: squeeze
            };
        }).filter(d => d !== null);

    } catch (e) {
        console.error(`Chart fetch failed for ${ticker}:`, e);
        return [];
    }
}

function calculateSMA(data, period) {
    const results = new Array(data.length).fill(null);
    for (let i = period - 1; i < data.length; i++) {
        const slice = data.slice(i - period + 1, i + 1);
        const sum = slice.reduce((a, b) => a + b, 0);
        results[i] = sum / period;
    }
    return results;
}

function calculateEMA(data, period) {
    const results = new Array(data.length).fill(null);
    const k = 2 / (period + 1);

    let sum = 0;
    for (let i = 0; i < period; i++) sum += data[i];
    results[period - 1] = sum / period;

    for (let i = period; i < data.length; i++) {
        results[i] = (data[i] * k) + (results[i - 1] * (1 - k));
    }
    return results;
}

function calculateStdDev(data, period, sma) {
    const results = new Array(data.length).fill(null);
    for (let i = period - 1; i < data.length; i++) {
        if (sma[i] === null) continue;
        const slice = data.slice(i - period + 1, i + 1);
        const mean = sma[i];
        const squaredDiffs = slice.map(v => Math.pow(v - mean, 2));
        const variance = squaredDiffs.reduce((a, b) => a + b, 0) / period;
        results[i] = Math.sqrt(variance);
    }
    return results;
}

function calculateATR(highs, lows, closes, period) {
    const trs = new Array(closes.length).fill(0);
    trs[0] = highs[0] - lows[0];

    for (let i = 1; i < closes.length; i++) {
        const h = highs[i];
        const l = lows[i];
        const cp = closes[i - 1];

        const val1 = h - l;
        const val2 = Math.abs(h - cp);
        const val3 = Math.abs(l - cp);
        trs[i] = Math.max(val1, val2, val3);
    }

    const results = new Array(closes.length).fill(null);

    let sum = 0;
    for (let i = 0; i < period; i++) sum += trs[i];
    results[period - 1] = sum / period;

    for (let i = period; i < closes.length; i++) {
        const prev = results[i - 1];
        results[i] = ((prev * (period - 1)) + trs[i]) / period;
    }

    return results;
}
