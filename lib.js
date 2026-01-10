import YahooFinance from 'yahoo-finance2';
const yahooFinance = new YahooFinance();

// --- CONFIGURATION ---
export const ETFS = [
    'ITA', 'ROBO', 'PEJ', 'BLOK', 'TAN', 'CIBR', 'IGV', 'ARKG', 'KWEB',
    'XLE', 'SMH', 'XLV', 'XLF', 'FDN', 'XLY', 'XLB', 'UFO', 'XRT', 'XBI',
    'ITB', 'MSOS', 'IYT', 'XLP', 'IYZ', 'NLR', 'XME', 'GDX', 'JETS', 'PBW'
];

export const SCORING_CONFIG = {
    MIN_PRICE: 5,
    MIN_PERCENT_CHANGE: -20,
    MAX_PERCENT_CHANGE: 20,
    MAX_UD_RATIO: 5,
    MIN_EMA_DISTANCE: -10,
    MAX_EMA_DISTANCE: 10,
    MAX_VIX_SPIKE: 0.50,
    UNDERCUT_TOLERANCE: -0.5,
};

export const BASE_WEIGHTS = {
    dailyPerformance: 0.05,
    strength: 0.1,
    accumulation: 0.1,
    pullback: 0.4,
    risk: 0.1,
    rsLineMomentum: 0.25,
};

// Standardized U-shaped volume profile (Cumulative)
export const CUMULATIVE_VOLUME_PROFILE = [
    // 1 - minute resolution for the first 15 minutes
    0.008, 0.016, 0.024, 0.032, 0.040, // 0 - 5 mins
    0.047, 0.054, 0.061, 0.068, 0.075, // 6 - 10 mins
    0.081, 0.087, 0.093, 0.099, 0.105, // 11 - 15 mins

    // 5 - minute resolution from 15 minutes onwards
    0.130, 0.153, 0.173, 0.191, 0.208, 0.224,
    0.239, 0.253, 0.266, 0.279, 0.291, 0.303, 0.315, 0.327,
    0.339, 0.350, 0.361, 0.372, 0.383, 0.394, 0.405, 0.416, 0.427, 0.438,
    0.449, 0.460, 0.471, 0.482, 0.493, 0.504, 0.515, 0.526, 0.537, 0.548,
    0.559, 0.570, 0.581, 0.592, 0.603, 0.614, 0.625, 0.636, 0.647, 0.658,
    0.669, 0.680, 0.691, 0.702, 0.713, 0.724, 0.735, 0.746, 0.757, 0.768,
    0.779, 0.790, 0.801, 0.812, 0.823, 0.834, 0.845, 0.856, 0.867, 0.878,
    0.889, 0.900, 0.912, 0.924, 0.936, 0.948, 0.962, 0.978, 1.000, 1.000
];

// --- HELPER CLASSES (REPLACING PANDAS) ---

export class PandasLite {
    static mean(arr) {
        if (!arr.length) return 0;
        return arr.reduce((a, b) => a + b, 0) / arr.length;
    }

    static std(arr) {
        if (arr.length < 2) return 0;
        const avg = this.mean(arr);
        const squareDiffs = arr.map(v => Math.pow(v - avg, 2));
        return Math.sqrt(this.mean(squareDiffs));
    }

    static ema(values, span) {
        if (!values.length) return [];
        const k = 2 / (span + 1);
        let ema = values[0];
        const result = [ema];
        for (let i = 1; i < values.length; i++) {
            ema = (values[i] * k) + (ema * (1 - k));
            result.push(ema);
        }
        return result;
    }

    static rollingMean(values, windowSize) {
        const result = [];
        for (let i = 0; i < values.length; i++) {
            if (i < windowSize - 1) {
                result.push(null);
                continue;
            }
            const slice = values.slice(i - windowSize + 1, i + 1);
            result.push(this.mean(slice));
        }
        return result;
    }

    static rollingStd(values, windowSize) {
        const result = [];
        for (let i = 0; i < values.length; i++) {
            if (i < windowSize - 1) {
                result.push(null);
                continue;
            }
            const slice = values.slice(i - windowSize + 1, i + 1);
            result.push(this.std(slice));
        }
        return result;
    }

    static calculateATR(highs, lows, closes, period = 14) {
        const tr = [];
        for (let i = 0; i < highs.length; i++) {
            if (i === 0) {
                tr.push(highs[i] - lows[i]);
            } else {
                const hl = highs[i] - lows[i];
                const h_pc = Math.abs(highs[i] - closes[i - 1]);
                const l_pc = Math.abs(lows[i] - closes[i - 1]);
                tr.push(Math.max(hl, h_pc, l_pc));
            }
        }
        // Use simple rolling mean for ATR approximation (like the python script rolling(14).mean())
        return this.rollingMean(tr, period);
    }
}

// --- LOGIC CLASSES ---

export class QuantScorer {
    static sigmoidNormalize(value, minVal, maxVal, steepness = 1.0, asymmetric = false) {
        if (maxVal === minVal) {
            return value === minVal ? 0.5 : (value > maxVal ? 1.0 : 0.0);
        }
        const clamped = Math.max(minVal, Math.min(maxVal, value));
        const linear = (clamped - minVal) / (maxVal - minVal);
        let adjSteepness = steepness;
        if (asymmetric && linear < 0.5) adjSteepness *= 1.5;
        return 1 / (1 + Math.exp(-adjSteepness * (linear - 0.5) * 10));
    }

    static normalizeWeights(weights) {
        let total = 0;
        for (const k in weights) total += Math.max(0, weights[k]);
        if (total === 0) total = 1;
        const normalized = {};
        for (const k in weights) normalized[k] = Math.max(0, weights[k]) / total;
        return normalized;
    }

    static getAdjustedWeights(vixData) {
        const weights = { ...BASE_WEIGHTS };
        if (!vixData || vixData.price <= 0) return this.normalizeWeights(weights);

        const vixPrice = vixData.price;
        const vxvPrice = vixData.vxvPrice || vixPrice;
        const prevClose = vixData.previousClose || vixPrice;

        const vvRatio = vxvPrice > 0 ? vixPrice / vxvPrice : 1.0;
        const vixDayChange = Math.min(SCORING_CONFIG.MAX_VIX_SPIKE, (vixPrice - prevClose) / prevClose);

        if (vvRatio > 1.0 || vixDayChange > 0.10) {
            const stress = Math.max(vvRatio, 1 + vixDayChange);
            weights.risk += 0.15 * stress;
            weights.pullback += 0.10;
            weights.dailyPerformance -= 0.20;
            weights.rsLineMomentum += 0.10;
        } else if (vvRatio < 0.85) {
            weights.strength += 0.10;
        }
        return this.normalizeWeights(weights);
    }

    static calculateSlope(current, previous) {
        if (previous === 0) return 0;
        return (current - previous) / previous;
    }

    static getPullbackSubScore(distance, idealMax, slope) {
        let baseScore = 0;
        if (distance >= SCORING_CONFIG.UNDERCUT_TOLERANCE && distance <= idealMax) {
            baseScore = 1.0;
        } else if (distance > idealMax) {
            const excess = distance - idealMax;
            baseScore = Math.max(0, 1 - (excess / (idealMax * 2)));
        } else {
            const severity = Math.abs(distance - SCORING_CONFIG.UNDERCUT_TOLERANCE);
            baseScore = Math.max(0, 1 - Math.pow(severity, 2) / 2);
        }

        let slopeMultiplier = 1.0;
        if (slope > 0.005) slopeMultiplier = 1.2;
        else if (slope < 0) slopeMultiplier = 0.5;
        else if (slope <= 0.001) slopeMultiplier = 0.8;

        return baseScore * slopeMultiplier;
    }

    static calculateScore(stock, vixData, spyChange) {
        const weights = this.getAdjustedWeights(vixData);

        // Daily Perf
        const relativeAlpha = stock.percentChange - spyChange;
        let dailyPerfScore = this.sigmoidNormalize(relativeAlpha, -3, 3, 2.0, true);
        if (spyChange < -1.5 && stock.percentChange > 0) dailyPerfScore = Math.min(1.0, dailyPerfScore + 0.15);

        // Strength
        const strengthScore = this.sigmoidNormalize(stock.rsRating, 0.5, 1.5, 2.0, true);

        // Accumulation
        const accumulationScore = this.sigmoidNormalize(stock.udRatio, 0.7, 2.5, 1.5, true);

        // Pullback
        const slope10 = this.calculateSlope(stock.ema10, stock.ema10Prev5);
        const slope20 = this.calculateSlope(stock.ema20, stock.ema20Prev5);
        const slope50 = this.calculateSlope(stock.ema50, stock.ema50Prev5);

        const dist10Score = this.getPullbackSubScore(stock.distanceFrom10EMA, 1.5, slope10);
        const dist20Score = this.getPullbackSubScore(stock.distanceFrom20EMA, 2.0, slope20);
        const dist50Score = this.getPullbackSubScore(stock.distanceFrom50EMA, 4.0, slope50);

        const rawPullback = (dist10Score * 0.4) + (dist20Score * 0.4) + (dist50Score * 0.2);
        let pullbackScore = Math.max(0, Math.min(1.0, rawPullback));

        // Trend Checks
        const isEma200Valid = stock.ema200 > 0;
        let bullish = (stock.price > stock.ema50) && (stock.ema10 > stock.ema20) && (stock.ema20 > stock.ema50);
        if (isEma200Valid) bullish = bullish && (stock.ema50 > stock.ema200);

        const atr = Math.max(0.0001, stock.atr);
        const emaSep = Math.abs(stock.ema10 - stock.ema20) / atr;
        const isCoiled = emaSep < 0.5;
        const isBouncing = stock.distanceFrom10EMA >= 0;
        const hasHighRs = this.sigmoidNormalize(stock.rsLineSlope * 100, 0, 15) > 0.8;

        if (bullish && isCoiled && isBouncing && hasHighRs) pullbackScore = Math.min(1.0, pullbackScore + 0.25);


        // Risk
        const dists = [stock.distanceFrom10EMA, stock.distanceFrom20EMA, stock.distanceFrom50EMA];
        const supports = dists.filter(d => d >= 0);
        const resistances = dists.filter(d => d < 0);
        let riskScore = 0;
        const riskWindow = bullish ? 4.0 : 3.0;

        if (supports.length > 0) {
            const nearestBelow = Math.min(...supports);
            riskScore = 1 - this.sigmoidNormalize(nearestBelow, 0, riskWindow, 1.5);
        } else {
            const nearestAbove = resistances.length ? Math.max(...resistances) : -5;
            riskScore = 0.2 * this.sigmoidNormalize(nearestAbove, -5, 0, 1.0);
        }
        riskScore = Math.max(0, Math.min(1.0, riskScore));

        // RS Momentum
        const rsSlopePct = stock.rsLineSlope * 100;
        const rsMult = (spyChange <= 0 && rsSlopePct > 0) ? 1.25 : 1.0;
        const rsMomScore = Math.min(1.0, this.sigmoidNormalize(rsSlopePct, 0, 15, 1.0) * rsMult);

        // Composite
        const composite =
            (dailyPerfScore * weights.dailyPerformance) +
            (strengthScore * weights.strength) +
            (accumulationScore * weights.accumulation) +
            (pullbackScore * weights.pullback) +
            (riskScore * weights.risk) +
            (rsMomScore * weights.rsLineMomentum);

        // Penalties
        let adrPenalty = stock.percentADR > 20 ? 0.85 : (stock.percentADR < 1.5 ? 0.9 : 1.0);
        let pricePenalty = 1.0;
        if (stock.price < 5) {
            pricePenalty = stock.price < 1 ? 0.6 : 0.7 + 0.3 * ((stock.price - 1) / 4);
        }
        let trendPenalty = 1.0;
        if (stock.ema200 > 0 && stock.price < stock.ema200) trendPenalty = 0.6;

        return Math.max(0, Math.min(100, Math.round(composite * adrPenalty * pricePenalty * trendPenalty * 100)));
    }
}

export class IntradayPredictor {
    static clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }

    static getProjectedRelativeVolume(currentVolume, avgVolume, minutesSinceOpen) {
        if (avgVolume === 0) return 0.0;
        if (minutesSinceOpen >= 390) return currentVolume / avgVolume;

        let percentComplete = 0.0;
        if (minutesSinceOpen < 15) {
            const idx = Math.min(14, Math.max(0, Math.floor(minutesSinceOpen)));
            percentComplete = CUMULATIVE_VOLUME_PROFILE[idx];
        } else {
            const idx = 15 + Math.floor((minutesSinceOpen - 15) / 5);
            percentComplete = CUMULATIVE_VOLUME_PROFILE[Math.min(CUMULATIVE_VOLUME_PROFILE.length - 1, idx)];
        }
        percentComplete = Math.max(0.001, Math.min(1.0, percentComplete));
        const projVol = currentVolume / percentComplete;
        return Math.max(0.0, projVol / avgVolume);
    }

    static predict(inputs) {
        // ... (Ported simplified logic for brevity, matches structure)
        const params = {
            INTRADAY_TANH_SCALE: 3.0, VM_FLOOR: 0.5, VM_CEIL: 10.0,
            TIME_DECAY_ALPHA: 0.5, HOLD_THRESHOLD: 0.01, MAX_VOLUME_BOOST: 0.3,
            ADR_CAP_MULTIPLE: 3.0, ATR_ZSCORE_CAP: 3.0, ATR_WEIGHT: 0.7,
            EXTREME_VOLATILITY_THRESHOLD: 1.5
        };

        const {
            openPrice, currentPrice, prevClose, vwap, relativeVolume, percentADR,
            minutesSinceOpen, roc, gapPercent
        } = inputs;

        if (openPrice <= 0 || prevClose <= 0) return 0.0;

        const returnSoFar = (currentPrice - prevClose) / prevClose;
        const remainingFrac = this.clamp((390 - minutesSinceOpen) / 390, 0, 1);

        // Simplified prediction logic for Node port
        const volumeMult = this.clamp(1 + Math.log(Math.max(0.1, relativeVolume)), 0.5, 10);
        const adrFrac = percentADR / 100;
        const projectedRange = this.clamp(adrFrac * volumeMult, adrFrac * 0.3, adrFrac * 12);

        const priceVsOpen = (currentPrice - openPrice) / openPrice;
        let intradayScore = Math.tanh(priceVsOpen * 5.0 + roc * 20); // Simplified heuristic

        const remainingPotential = Math.max(0, projectedRange - Math.abs(returnSoFar));
        const directionalMove = remainingPotential * intradayScore * Math.pow(remainingFrac, 0.5);

        let predictedReturn = returnSoFar + directionalMove;

        // Cap
        const cap = Math.max(Math.abs(gapPercent / 100), adrFrac * 3);
        predictedReturn = this.clamp(predictedReturn, -cap, cap);

        return Number((predictedReturn * 100).toFixed(2));
    }
}

// --- DATA FETCHING & PROCESSING ---

export async function fetchMarketContext() {
    console.log("Fetching Market Context (SPY, VIX)...");
    const today = new Date();
    const twoYearsAgo = new Date();
    twoYearsAgo.setFullYear(today.getFullYear() - 2);

    const queryOptions = { period1: twoYearsAgo, interval: '1d' };

    try {
        const spyData = await yahooFinance.chart('SPY', queryOptions);
        const vixData = await yahooFinance.chart('^VIX', { period1: new Date(Date.now() - 7 * 86400000), interval: '1d' });

        const spyMap = {}; // Date string -> Close
        spyData.quotes.forEach(q => {
            if (q.date) spyMap[q.date.toISOString().split('T')[0]] = q.close;
        });

        const currentVix = vixData.quotes[vixData.quotes.length - 1];
        const prevVix = vixData.quotes[vixData.quotes.length - 2];

        return {
            spyData: spyData.quotes,
            spyMap,
            vixContext: {
                price: currentVix.close,
                previousClose: prevVix.close,
                vxvPrice: currentVix.close // simplified
            }
        };
    } catch (e) {
        console.error("Error fetching market context:", e.message);
        return null;
    }
}

export async function getHoldings(etfs) {
    console.log("\n--- FETCHING ETF HOLDINGS ---");
    const holdings = new Set();

    // Chunk requests to be polite
    for (const etf of etfs) {
        try {
            const summary = await yahooFinance.quoteSummary(etf, { modules: ["topHoldings"] });
            if (summary.topHoldings && summary.topHoldings.holdings) {
                summary.topHoldings.holdings.forEach(h => {
                    if (h.symbol) holdings.add(h.symbol);
                });
                process.stdout.write(".");
            }
        } catch (e) {
            process.stdout.write("x");
        }
    }
    console.log(`\nFound ${holdings.size} unique holdings.`);
    return Array.from(holdings);
}

export function calculateMetrics(ticker, quotes, context) {
    if (!quotes || quotes.length < 50) return null;

    const closes = quotes.map(q => q.close);
    const highs = quotes.map(q => q.high);
    const lows = quotes.map(q => q.low);
    const volumes = quotes.map(q => q.volume);

    const currentPrice = closes[closes.length - 1];
    const prevClose = closes[closes.length - 2];
    const openPrice = quotes[quotes.length - 1].open;
    const high = quotes[quotes.length - 1].high;
    const low = quotes[quotes.length - 1].low;

    // Technicals
    const ema10s = PandasLite.ema(closes, 10);
    const ema20s = PandasLite.ema(closes, 20);
    const ema50s = PandasLite.ema(closes, 50);
    const ema200s = PandasLite.ema(closes, 200);

    const ema10 = ema10s[ema10s.length - 1];
    const ema20 = ema20s[ema20s.length - 1];
    const ema50 = ema50s[ema50s.length - 1];
    const ema200 = ema200s.length ? ema200s[ema200s.length - 1] : 0;

    const ema10Prev5 = ema10s[ema10s.length - 6] || ema10;
    const ema20Prev5 = ema20s[ema20s.length - 6] || ema20;
    const ema50Prev5 = ema50s[ema50s.length - 6] || ema50;

    // ATR & Bands
    const atrs = PandasLite.calculateATR(highs, lows, closes, 14);
    const atr = atrs[atrs.length - 1] || 0.01;

    // Percent ADR
    const dailyRatios = highs.map((h, i) => h / (lows[i] || 1));
    const avgRatio = PandasLite.mean(dailyRatios.slice(-20));
    const percentADR = (avgRatio - 1) * 100;

    // Distances
    const dist10 = ((currentPrice - ema10) / ema10) * 100;
    const dist20 = ((currentPrice - ema20) / ema20) * 100;
    const dist50 = ((currentPrice - ema50) / ema50) * 100;

    const dist10_atr = (currentPrice - ema10) / atr;
    const dist20_atr = (currentPrice - ema20) / atr;
    const dist50_atr = (currentPrice - ema50) / atr;

    // Squeeze
    const std20 = PandasLite.rollingStd(closes, 20);
    const curStd = std20[std20.length - 1];
    const lowerBB = ema20 - (2 * curStd);
    const upperBB = ema20 + (2 * curStd);
    const lowerKC = ema20 - (1.5 * atr);
    const upperKC = ema20 + (1.5 * atr);
    const squeezeStatus = (lowerBB > lowerKC && upperBB < upperKC) ? "High Compression" : "No";

    // RS Calculation
    let rsRating = 1.0;
    let rsLineSlope = 0.0;
    let rsOneDayChange = 0.0;
    let spyChange = 0.0;

    if (context && context.spyMap) {
        // Build RS Line
        const rsLine = [];
        quotes.forEach(q => {
            if (!q.date) return;
            const dStr = q.date.toISOString().split('T')[0];
            const spyClose = context.spyMap[dStr];
            if (spyClose) rsLine.push(q.close / spyClose);
        });

        if (rsLine.length > 20) {
            // Simple RS Rating Proxy
            const getPerf = (arr, days) => (arr[arr.length - 1] - arr[arr.length - 1 - days]) / arr[arr.length - 1 - days];
            // We need spy array for this, approximating with just stock perf vs spy perf logic handled elsewhere or simplified here
            rsRating = 1.0; // Placeholder for full calc
            rsLineSlope = (rsLine[rsLine.length - 1] - rsLine[rsLine.length - 21]) / rsLine[rsLine.length - 21];
            rsOneDayChange = (rsLine[rsLine.length - 1] - rsLine[rsLine.length - 2]) / rsLine[rsLine.length - 2];
        }

        // Calculate SPY change for today
        const spyQuotes = context.spyData;
        const spyLast = spyQuotes[spyQuotes.length - 1].close;
        const spyPrev = spyQuotes[spyQuotes.length - 2].close;
        spyChange = ((spyLast - spyPrev) / spyPrev) * 100;
    }

    // UD Ratio
    let upVol = 0, downVol = 0;
    for (let i = quotes.length - 20; i < quotes.length; i++) {
        if (i < 1) continue;
        if (closes[i] > closes[i - 1]) upVol += volumes[i];
        else if (closes[i] < closes[i - 1]) downVol += volumes[i];
    }
    const udRatio = downVol > 0 ? upVol / downVol : 5.0;

    // Intraday Setup
    const now = new Date();
    // Assuming market open 9:30 ET. Convert current time to ET minutes from open.
    // Simplified: Assuming running during market hours or just using static calc
    let minutesSinceOpen = 390; // Default to EOD
    // ... Real time calculation requires timezone handling (luxon), skipping for brevity

    const avgVol = PandasLite.mean(volumes.slice(-20));
    const curVol = volumes[volumes.length - 1];
    const relVol = IntradayPredictor.getProjectedRelativeVolume(curVol, avgVol, minutesSinceOpen);

    const percentChange = ((currentPrice - prevClose) / prevClose) * 100;
    const gapPercent = ((openPrice - prevClose) / prevClose) * 100;
    const roc = minutesSinceOpen > 0 ? percentChange / minutesSinceOpen : 0;

    const predictorInputs = {
        openPrice, currentPrice, prevClose, vwap: (high + low + currentPrice) / 3,
        relativeVolume: relVol, percentADR, minutesSinceOpen, roc, gapPercent
    };

    const predChange = IntradayPredictor.predict(predictorInputs);

    // Score
    const stockObj = {
        price: currentPrice, high, low, percentChange, udRatio, rsRating, percentADR,
        atr, distanceFrom10EMA: dist10, distanceFrom20EMA: dist20, distanceFrom50EMA: dist50,
        ema10, ema20, ema50, ema200, ema10Prev5, ema20Prev5, ema50Prev5, rsLineSlope
    };

    const quantScore = QuantScorer.calculateScore(stockObj, context.vixContext, spyChange);

    return {
        'Quant Score': quantScore,
        ticker,
        price: Number(currentPrice.toFixed(2)),
        percentChange: Number(percentChange.toFixed(2)),
        RVol: Number(relVol.toFixed(2)),
        '%Pred': predChange,
        'RS Delta': Number((rsOneDayChange * 100).toFixed(2)),
        udRatio: Number(udRatio.toFixed(2)),
        squeezeStatus,
        atr: Number(atr.toFixed(2)),
        percentADR: Number(percentADR.toFixed(2)),
        '10EMA (ATR)': Number(dist10_atr.toFixed(2)),
        '20EMA (ATR)': Number(dist20_atr.toFixed(2)),
        '50EMA (ATR)': Number(dist50_atr.toFixed(2))
    };
}

export async function processBatch(tickers, context) {
    const results = [];
    const twoYearsAgo = new Date();
    twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);

    for (const ticker of tickers) {
        try {
            const data = await yahooFinance.chart(ticker, { period1: twoYearsAgo, interval: '1d' });
            const metrics = calculateMetrics(ticker, data.quotes, context);
            if (metrics) results.push(metrics);
        } catch (e) {
            // Silent fail for delisted
        }
    }
    return results;
}
