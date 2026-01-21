import yahooFinance from 'yahoo-finance2';

// Suppress validation errors in Cloud Functions environment
yahooFinance.suppressNotices(['yahooSurvey']);
yahooFinance.setGlobalConfig({ validation: { logErrors: false } });


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

    static calculateSMAValues(values, period) {
        const sma = new Array(values.length).fill(null);
        if (values.length < period) return sma;

        for (let i = period - 1; i < values.length; i++) {
            const slice = values.slice(i - period + 1, i + 1);
            sma[i] = slice.reduce((sum, val) => sum + val, 0) / period;
        }
        return sma;
    }

    static calculateStdevValues(values, period) {
        const stdevs = new Array(values.length).fill(null);
        if (values.length < period) return stdevs;

        for (let i = period - 1; i < values.length; i++) {
            const slice = values.slice(i - period + 1, i + 1);
            const mean = slice.reduce((sum, val) => sum + val, 0) / period;
            const sqDiffs = slice.map(val => Math.pow(val - mean, 2));
            const variance = sqDiffs.reduce((sum, val) => sum + val, 0) / period;
            stdevs[i] = Math.sqrt(variance);
        }
        return stdevs;
    }

    static getSqueezeStatus(bbUpper, bbLower, kcUppers, kcLowers) {
        if (bbUpper > kcUppers[2] || bbLower < kcLowers[2]) return 'No';
        if (bbUpper <= kcUppers[0] && bbLower >= kcLowers[0]) return 'High';
        if (bbUpper <= kcUppers[1] && bbLower >= kcLowers[1]) return 'Medium';
        return 'Low';
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
        // --- Input Validation & Sanitization (Sync with provided algorithm) ---
        const stockCopy = { ...stock };
        const requiredProps = ['price', 'high', 'low', 'percentChange', 'rsRating', 'udRatio', 'percentADR', 'atr', 'distanceFrom10EMA', 'distanceFrom20EMA', 'distanceFrom50EMA', 'ema10', 'ema20', 'ema50', 'rsLineSlope', 'ema10Prev5', 'ema20Prev5', 'ema50Prev5'];

        for (const prop of requiredProps) {
            const val = stockCopy[prop];
            if (val == null || !Number.isFinite(val)) {
                stockCopy[prop] = (prop === 'rsRating' || prop === 'udRatio') ? 1.0 : (prop === 'price' ? SCORING_CONFIG.MIN_PRICE : 0);
            }
        }

        // Explicit ATR Validations
        if (stockCopy.atr <= 0) stockCopy.atr = 0.0001;

        // Input Clamping
        stockCopy.percentChange = Math.max(SCORING_CONFIG.MIN_PERCENT_CHANGE, Math.min(SCORING_CONFIG.MAX_PERCENT_CHANGE, stockCopy.percentChange));
        stockCopy.udRatio = Math.max(0, Math.min(SCORING_CONFIG.MAX_UD_RATIO, stockCopy.udRatio));
        stockCopy.distanceFrom10EMA = Math.max(SCORING_CONFIG.MIN_EMA_DISTANCE, Math.min(SCORING_CONFIG.MAX_EMA_DISTANCE, stockCopy.distanceFrom10EMA));
        stockCopy.distanceFrom20EMA = Math.max(SCORING_CONFIG.MIN_EMA_DISTANCE, Math.min(SCORING_CONFIG.MAX_EMA_DISTANCE, stockCopy.distanceFrom20EMA));
        stockCopy.distanceFrom50EMA = Math.max(SCORING_CONFIG.MIN_EMA_DISTANCE, Math.min(SCORING_CONFIG.MAX_EMA_DISTANCE, stockCopy.distanceFrom50EMA));


        const weights = this.getAdjustedWeights(vixData);

        // Daily Perf
        const relativeAlpha = stockCopy.percentChange - spyChange;
        let dailyPerfScore = this.sigmoidNormalize(relativeAlpha, -3, 3, 2.0, true);
        if (spyChange < -1.5 && stockCopy.percentChange > 0) dailyPerfScore = Math.min(1.0, dailyPerfScore + 0.15);

        // Strength
        const strengthScore = this.sigmoidNormalize(stockCopy.rsRating, 0.5, 1.5, 2.0, true);

        // Accumulation
        const accumulationScore = this.sigmoidNormalize(stockCopy.udRatio, 0.7, 2.5, 1.5, true);

        // Pullback
        const slope10 = this.calculateSlope(stockCopy.ema10, stockCopy.ema10Prev5);
        const slope20 = this.calculateSlope(stockCopy.ema20, stockCopy.ema20Prev5);
        const slope50 = this.calculateSlope(stockCopy.ema50, stockCopy.ema50Prev5);

        const dist10Score = this.getPullbackSubScore(stockCopy.distanceFrom10EMA, 1.5, slope10);
        const dist20Score = this.getPullbackSubScore(stockCopy.distanceFrom20EMA, 2.0, slope20);
        const dist50Score = this.getPullbackSubScore(stockCopy.distanceFrom50EMA, 4.0, slope50);

        let rawPullback = (dist10Score * 0.4) + (dist20Score * 0.4) + (dist50Score * 0.2);

        // Trend Checks
        const isEma200Valid = stockCopy.ema200 && stockCopy.ema200 > 0;
        let bullish = (stockCopy.price > stockCopy.ema50) && (stockCopy.ema10 > stockCopy.ema20) && (stockCopy.ema20 > stockCopy.ema50);
        if (isEma200Valid) bullish = bullish && (stockCopy.ema50 > stockCopy.ema200);

        const atr = stockCopy.atr;
        const emaSep = Math.abs(stockCopy.ema10 - stockCopy.ema20) / atr;
        const isCoiled = emaSep < 0.5;
        const isBouncing = stockCopy.distanceFrom10EMA >= 0;
        const hasHighRs = this.sigmoidNormalize(stockCopy.rsLineSlope * 100, 0, 15) > 0.8;

        if (bullish && isCoiled && isBouncing && hasHighRs) rawPullback += 0.25;

        let pullbackScore = Math.max(0, Math.min(1.0, rawPullback));


        // Risk
        const dists = [stockCopy.distanceFrom10EMA, stockCopy.distanceFrom20EMA, stockCopy.distanceFrom50EMA];
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
        const rsSlopePct = stockCopy.rsLineSlope * 100;
        const rsMult = (spyChange <= 0 && rsSlopePct > 0) ? 1.25 : 1.0;
        const rsMomScore = Math.min(1.0, this.sigmoidNormalize(rsSlopePct, 0, 15, 1.0) * rsMult);

        // Composite
        let composite =
            (dailyPerfScore * weights.dailyPerformance) +
            (strengthScore * weights.strength) +
            (accumulationScore * weights.accumulation) +
            (pullbackScore * weights.pullback) +
            (riskScore * weights.risk) +
            (rsMomScore * weights.rsLineMomentum);

        // Penalties
        let adrPenalty = 1.0;
        if (stockCopy.percentADR > 20) adrPenalty = 0.85;
        else if (stockCopy.percentADR < 1.5) adrPenalty = 0.9;

        let pricePenalty = 1.0;
        if (stockCopy.price < SCORING_CONFIG.MIN_PRICE) {
            if (stockCopy.price >= 1) pricePenalty = 0.7 + 0.3 * ((stockCopy.price - 1) / (SCORING_CONFIG.MIN_PRICE - 1));
            else pricePenalty = 0.6;
        }

        // Note: Removed extra trendPenalty to match original provided algorithm logic exactly.

        return Math.max(0, Math.min(100, Math.round(composite * adrPenalty * pricePenalty * 100)));
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

    static getVolatilityRegime(vixLevel, vixChange, atrZScore) {
        let baseMultiplier = 1.0;
        let vixRegime = 'unknown';

        if (vixLevel !== undefined) {
            if (vixLevel < 15) {
                vixRegime = 'low_vol';
                baseMultiplier = 1.2 - (vixChange / 200);
            } else if (vixLevel > 30) {
                vixRegime = 'high_vol';
                baseMultiplier = 0.8 - (vixChange / 100);
            } else {
                vixRegime = 'normal_vol';
                baseMultiplier = 1.0 - (vixChange / 150);
            }
        }

        let volatilityRegime = 'normal';
        let atrAdjustment = 1.0;

        if (atrZScore !== null) {
            if (Math.abs(atrZScore) > 2) {
                volatilityRegime = 'extreme';
                atrAdjustment = atrZScore > 0 ? 0.7 : 1.3;
            } else if (Math.abs(atrZScore) > 1) {
                volatilityRegime = 'elevated';
                atrAdjustment = atrZScore > 0 ? 0.85 : 1.15;
            }
        }

        return {
            regime: vixRegime,
            multiplier: this.clamp(baseMultiplier * atrAdjustment, 0.5, 1.5),
            volatilityRegime
        };
    }

    static calculateProjectedRange(percentADR, atr14, atr14Mean, atr14Std, currentPrice, volumeMultiplier, gapPercent, params) {
        const adrFrac = percentADR / 100;
        let atrZScore = null;
        let atrBasedRange = 0;

        if ([atr14, atr14Mean, atr14Std].every(Number.isFinite) && atr14Std > 0) {
            atrZScore = this.clamp((atr14 - atr14Mean) / atr14Std, -3, 3);
            const atrPercent = atr14 / currentPrice;
            const volatilityScaler = this.clamp(1 + atrZScore * 0.2, 0.6, 1.6);
            atrBasedRange = atrPercent * volatilityScaler;
        }

        let baseRange;
        if (atrBasedRange > 0) {
            const atrWeight = params.ATR_WEIGHT ?? 0.7;
            const adrWeight = 1 - atrWeight;
            baseRange = (atrBasedRange * atrWeight) + (adrFrac * adrWeight);
            baseRange = Math.max(baseRange, adrFrac * 0.5);
        } else {
            baseRange = adrFrac;
            atrBasedRange = adrFrac;
        }

        const volumeAdjustedRange = baseRange * volumeMultiplier;
        const gapAdjustedRange = Math.max(volumeAdjustedRange, Math.abs(gapPercent / 100));
        const finalProjected = this.clamp(gapAdjustedRange, adrFrac * 0.3, adrFrac * 12);

        return {
            projectedRange: finalProjected,
            atrZScore,
            breakdown: { adrComponent: adrFrac, atrComponent: atrBasedRange, finalProjected }
        };
    }

    static getAdaptiveWeights(gapPercent, relativeVolume, minutesSinceOpen) {
        const progress = this.clamp(minutesSinceOpen / 390, 0, 1);
        const isSigGap = Math.abs(gapPercent) > 2;
        const isHighVol = relativeVolume > 2;

        if (progress < 0.3) {
            if (isSigGap && isHighVol) return { wOpen: 0.5, wVwap: 0.2, wRoc: 0.3 };
            if (isSigGap) return { wOpen: 0.6, wVwap: 0.2, wRoc: 0.2 };
            return { wOpen: 0.4, wVwap: 0.4, wRoc: 0.2 };
        }

        if (progress < 0.7) {
            if (isHighVol) return { wOpen: 0.3, wVwap: 0.5, wRoc: 0.2 };
            return { wOpen: 0.4, wVwap: 0.4, wRoc: 0.2 };
        }

        return { wOpen: 0.5, wVwap: 0.4, wRoc: 0.1 };
    }

    static calculateHoldFactor(gapPercent, priceVsOpen, priceVsVwap, params) {
        const gapAbs = Math.abs(gapPercent);
        if (gapAbs < 1) return 1.0;

        const gapDirection = Math.sign(gapPercent);
        let vsLevel = priceVsOpen;

        if (priceVsVwap !== null) {
            if (gapDirection > 0) vsLevel = Math.min(priceVsOpen, priceVsVwap);
            else vsLevel = Math.max(priceVsOpen, priceVsVwap);
        }

        const expectedHold = gapDirection > 0 ?
            vsLevel >= -params.HOLD_THRESHOLD :
            vsLevel <= params.HOLD_THRESHOLD;

        if (expectedHold) return 1.0;

        const decayAggression = params.HOLD_FACTOR_DECAY ?? 0.8;
        const gapFrac = Math.abs(gapPercent / 100);
        const deterioration = Math.abs(vsLevel) / (gapFrac + 1e-6);
        return Math.max(0.2, 1 - deterioration * decayAggression);
    }

    static predict(input) {
        const TOTAL_TRADING_MINUTES = 390;
        const params = {
            INTRADAY_TANH_SCALE: 3.0, VM_FLOOR: 0.5, VM_CEIL: 10.0,
            TIME_DECAY_ALPHA: 0.5, HOLD_THRESHOLD: 0.01, MAX_VOLUME_BOOST: 0.3,
            ADR_CAP_MULTIPLE: 3.0, ATR_ZSCORE_CAP: 3.0, ATR_WEIGHT: 0.7,
            EXTREME_VOLATILITY_THRESHOLD: 1.5, MOMENTUM_STRONG_ROC: 0.2,
            LATE_DAY_FRACTION: 0.15, FAILED_GAP_MINUTES: 60,
            PERF_BIAS_WEAK: 0.35, PERF_BIAS_STRONG: 0.25, HOLD_FACTOR_DECAY: 0.8
        };

        let {
            openPrice, currentPrice, prevClose, vwap, relativeVolume,
            percentADR, atr14, atr14Mean, atr14Std, minutesSinceOpen,
            roc, gapPercent, vixPctChange, vixLevel, todayHigh, todayLow
        } = input;

        if (![openPrice, currentPrice, prevClose, percentADR].every(Number.isFinite) ||
            openPrice <= 0 || prevClose <= 0 || percentADR <= 0 || currentPrice <= 0) {
            return {
                predictedEodChange: 0,
                lowerBound: 0, upperBound: 0, confidenceLevel: 0,
                regime: 'invalid_input', atrZScore: null
            };
        }

        const sanitizedRelVol = this.clamp(Number.isFinite(relativeVolume) ? relativeVolume : 1, 0.1, 20);
        const sanitizedRoc = this.clamp(Number.isFinite(roc) ? roc : 0, -5, 5);
        let sanitizedGapPercent = this.clamp(Number.isFinite(gapPercent) ? gapPercent : 0, -50, 50);
        const sanitizedVixLevel = Number.isFinite(vixLevel) ? vixLevel : undefined;
        let normalizedVixPctChange = Number.isFinite(vixPctChange) ? vixPctChange : 0;
        normalizedVixPctChange = this.clamp(normalizedVixPctChange, -50, 50);

        minutesSinceOpen = this.clamp(Number.isFinite(minutesSinceOpen) ? minutesSinceOpen : 0, 0, TOTAL_TRADING_MINUTES);
        let computedGap = this.clamp(((openPrice - prevClose) / prevClose) * 100, -50, 50);

        let finalGapPercent = computedGap;
        if (Number.isFinite(gapPercent)) {
            const isZeroOverride = sanitizedGapPercent === 0 && Math.abs(computedGap) > 0.01;
            if (!isZeroOverride) finalGapPercent = sanitizedGapPercent;
        }
        const gapDirection = Math.sign(finalGapPercent);

        if (minutesSinceOpen >= TOTAL_TRADING_MINUTES) {
            const finalChange = ((currentPrice - prevClose) / prevClose) * 100;
            return {
                predictedEodChange: finalChange, lowerBound: finalChange, upperBound: finalChange,
                confidenceLevel: 1.0, regime: 'closed'
            };
        }

        const returnSoFar = (currentPrice - prevClose) / prevClose;
        const realizedRange = (Number.isFinite(todayHigh) && Number.isFinite(todayLow) && todayHigh > 0 && todayLow > 0)
            ? Math.max(0, (todayHigh - todayLow)) / prevClose
            : Math.abs(returnSoFar);

        const remainingFraction = this.clamp((TOTAL_TRADING_MINUTES - minutesSinceOpen) / TOTAL_TRADING_MINUTES, 0, 1);
        const volumeMultiplier = this.clamp(1 + Math.log(Math.max(0.1, sanitizedRelVol)), params.VM_FLOOR, params.VM_CEIL);

        const rangeCalculation = this.calculateProjectedRange(percentADR, atr14, atr14Mean, atr14Std, currentPrice, volumeMultiplier, finalGapPercent, params);
        const { projectedRange, atrZScore } = rangeCalculation;
        const clampedAtrZScore = atrZScore !== null ? this.clamp(atrZScore, -params.ATR_ZSCORE_CAP, params.ATR_ZSCORE_CAP) : null;

        const priceVsOpen = openPrice > 0 ? (currentPrice - openPrice) / openPrice : 0;
        const priceVsVwap = (vwap !== undefined && vwap > 0) ? (currentPrice - vwap) / vwap : null;

        const weights = this.getAdaptiveWeights(finalGapPercent, sanitizedRelVol, minutesSinceOpen);

        const rocCumulative = sanitizedRoc * Math.max(1, minutesSinceOpen);
        const isHighVol = sanitizedRelVol > 2;
        const isSmallGap = Math.abs(finalGapPercent) < 2;
        const rocInfluence = (isSmallGap || isHighVol) ? rocCumulative : rocCumulative * 0.25;

        let intradayRaw;
        let performanceScore = 0;
        if (priceVsVwap !== null) {
            const belowVWAP = priceVsVwap < 0;
            const belowOpen = priceVsOpen < 0;
            if (belowVWAP && belowOpen) {
                performanceScore -= params.PERF_BIAS_WEAK;
                if (sanitizedRoc <= 0) performanceScore -= params.PERF_BIAS_WEAK;
            } else if (!belowVWAP && !belowOpen) {
                performanceScore += params.PERF_BIAS_STRONG;
                if (sanitizedRoc >= 0) performanceScore += params.PERF_BIAS_STRONG;
            }
            intradayRaw = (priceVsOpen * weights.wOpen) + (priceVsVwap * weights.wVwap) +
                (Math.tanh(this.clamp(rocInfluence, -10, 10)) * weights.wRoc) + performanceScore;
        } else {
            const total = weights.wOpen + weights.wRoc;
            intradayRaw = (priceVsOpen * (weights.wOpen / total)) +
                (Math.tanh(this.clamp(rocInfluence, -10, 10)) * (weights.wRoc / total)) + performanceScore;
        }

        const { regime, multiplier: vixAtrMult, volatilityRegime } = this.getVolatilityRegime(sanitizedVixLevel, normalizedVixPctChange, clampedAtrZScore);
        const holdFactor = this.calculateHoldFactor(finalGapPercent, priceVsOpen, priceVsVwap, params);

        const gapAligned = Math.sign(sanitizedRoc) === gapDirection;
        const strongRocAnchor = Math.max(1e-6, params.MOMENTUM_STRONG_ROC);
        const momentumStrength = this.clamp(Math.abs(sanitizedRoc) / strongRocAnchor, 0, 1);
        const timeFactor = 0.5 + 0.5 * remainingFraction;
        const baseBoost = (gapAligned ? 0.2 : 0.1) * momentumStrength * timeFactor;
        const momentumBoost = 1 + baseBoost * (1 - weights.wRoc);

        const intradayScore = Math.tanh(intradayRaw * params.INTRADAY_TANH_SCALE) * holdFactor * vixAtrMult;
        const adjustedIntradayScore = intradayScore * momentumBoost;

        let timeDecay = Math.pow(remainingFraction, params.TIME_DECAY_ALPHA);
        if (sanitizedRelVol > 3) {
            const boost = Math.min(params.MAX_VOLUME_BOOST, Math.log10(sanitizedRelVol / 3.0) * 0.2);
            timeDecay *= (1 + Math.max(0, boost));
        }

        const remainingPotential = Math.max(0, projectedRange - realizedRange);
        const directionalMove = remainingPotential * adjustedIntradayScore * timeDecay;
        let predictedEodReturn = returnSoFar + directionalMove;

        // Caps and Bounds
        let regimeAddon = '';
        const hasCrossedAgainst = priceVsVwap !== null && gapDirection * priceVsVwap < 0;
        const isSignificantGap = Math.abs(finalGapPercent) > 2;
        const hasStayed = minutesSinceOpen > params.FAILED_GAP_MINUTES;
        const isFailedGap = isSignificantGap && isHighVol && hasCrossedAgainst && hasStayed;
        if (isFailedGap) regimeAddon = gapDirection > 0 ? '_failed_gap_up' : '_failed_gap_down';

        let baseCap = Math.max(Math.abs(finalGapPercent / 100), (percentADR / 100) * params.ADR_CAP_MULTIPLE);
        if (clampedAtrZScore !== null && Math.abs(clampedAtrZScore) > params.EXTREME_VOLATILITY_THRESHOLD) {
            const extremeMultiplier = 1 + (Math.abs(clampedAtrZScore) - params.EXTREME_VOLATILITY_THRESHOLD) * 0.25;
            baseCap *= Math.min(extremeMultiplier, 2.5);
        }
        const normalizedCap = this.clamp(baseCap, (percentADR / 100) * 0.3, (percentADR / 100) * 12);

        let buffer = (percentADR / 100) * (0.05 + Math.min(0.1, (0.05 * sanitizedRelVol) / 2));
        if (clampedAtrZScore !== null && Math.abs(clampedAtrZScore) > 1) {
            buffer *= (1 + Math.abs(clampedAtrZScore) * 0.1);
        }
        buffer *= 1 + 0.5 * momentumStrength * timeFactor * (gapAligned ? 1 : 0.5);

        const lateDay = remainingFraction < params.LATE_DAY_FRACTION;
        const strongTrend = gapAligned && !hasCrossedAgainst && momentumStrength > 0.3 && adjustedIntradayScore > 0.3 && (projectedRange - realizedRange) > 0.0 && Math.abs(priceVsOpen) > 0.01;

        const safeTodayHigh = Number.isFinite(todayHigh) ? todayHigh : 0;
        const safeTodayLow = Number.isFinite(todayLow) ? todayLow : 0;

        let shouldCapUp = gapDirection > 0 && safeTodayHigh > 0 && (!strongTrend || lateDay);
        let shouldCapDown = gapDirection < 0 && safeTodayLow > 0 && (!strongTrend || lateDay);
        if (isFailedGap) {
            if (gapDirection > 0) shouldCapUp = true;
            else shouldCapDown = true;
        }

        if (shouldCapUp) predictedEodReturn = Math.min(predictedEodReturn, (safeTodayHigh * (1 + buffer) - prevClose) / prevClose);
        if (shouldCapDown) predictedEodReturn = Math.max(predictedEodReturn, (safeTodayLow * (1 - buffer) - prevClose) / prevClose);

        predictedEodReturn = this.clamp(predictedEodReturn, -normalizedCap, normalizedCap);

        let baseInterval = projectedRange * 0.4;
        let confidence = 0.8;
        if (clampedAtrZScore !== null && Math.abs(clampedAtrZScore) > 2) {
            confidence -= 0.2;
            baseInterval *= (1.5 + (Math.abs(clampedAtrZScore) - 2) * 0.3);
        } else if (clampedAtrZScore !== null) {
            baseInterval *= (1.0 + Math.abs(clampedAtrZScore) * 0.2);
        }
        if (sanitizedRelVol > 5 || sanitizedRelVol < 0.5) confidence -= 0.1;
        if (sanitizedVixLevel !== undefined && sanitizedVixLevel > 30) confidence -= 0.1;
        if (isFailedGap) confidence -= 0.15;
        if (sanitizedRelVol < 0.5 && (clampedAtrZScore === null || Math.abs(clampedAtrZScore) < 1)) confidence -= 0.05;
        if (gapAligned && !hasCrossedAgainst && momentumStrength > 0.3 && (sanitizedVixLevel === undefined || sanitizedVixLevel < 18) && (clampedAtrZScore === null || Math.abs(clampedAtrZScore) < 1)) confidence += 0.03;
        confidence = this.clamp(confidence, 0.5, 0.9);

        const volUnc = (sanitizedRelVol > 5) ? 1.3 : (sanitizedRelVol < 0.5 ? 1.4 : 1.0);
        let interval = baseInterval * vixAtrMult * volUnc;
        interval = Math.max(interval, (percentADR / 100) * 0.05);

        let lower = this.clamp(predictedEodReturn - interval, -normalizedCap, normalizedCap);
        let upper = this.clamp(predictedEodReturn + interval, -normalizedCap, normalizedCap);

        if (shouldCapUp && safeTodayHigh > 0) upper = Math.min(upper, (safeTodayHigh * (1 + buffer) - prevClose) / prevClose);
        if (shouldCapDown && safeTodayLow > 0) lower = Math.max(lower, (safeTodayLow * (1 - buffer) - prevClose) / prevClose);

        return {
            predictedEodChange: parseFloat((predictedEodReturn * 100).toFixed(2)),
            lowerBound: parseFloat((lower * 100).toFixed(2)),
            upperBound: parseFloat((upper * 100).toFixed(2)),
            confidenceLevel: parseFloat(confidence.toFixed(2)),
            regime: regime + regimeAddon,
            atrZScore,
            volatilityRegime,
            projectedRangeBreakdown: rangeCalculation.breakdown
        };
    }
}

// --- DATA FETCHING & PROCESSING ---

export async function fetchMarketContext() {
    console.log("Fetching Market Context (SPY, VIX)...");
    const today = new Date();
    const twoYearsAgo = new Date();
    twoYearsAgo.setFullYear(today.getFullYear() - 2);

    const queryOptions = { period1: twoYearsAgo, interval: '1d' };

    const maxRetries = 3;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const spyData = await yahooFinance.chart('SPY', queryOptions);
            const vixData = await yahooFinance.chart('^VIX', { period1: new Date(Date.now() - 7 * 86400000), interval: '1d' });

            if (!spyData?.quotes?.length || !vixData?.quotes?.length) {
                throw new Error("Empty data received from Yahoo Finance");
            }

            const spyMap = {}; // Date string -> Close
            spyData.quotes.forEach(q => {
                if (q.date) spyMap[q.date.toISOString().split('T')[0]] = q.close;
            });

            const currentVix = vixData.quotes[vixData.quotes.length - 1];
            const prevVix = vixData.quotes[vixData.quotes.length - 2];

            // Calculate SPY Performance Metrics for RS Rating
            const spyQuotes = spyData.quotes;
            const getSpyPerf = (days) => {
                if (spyQuotes.length > days) {
                    const pOld = spyQuotes[spyQuotes.length - 1 - days].close;
                    const pCurr = spyQuotes[spyQuotes.length - 1].close;
                    return ((pCurr - pOld) / pOld) * 100;
                }
                return 0;
            };

            const spyPerformance = {
                performance3Month: getSpyPerf(63),
                performance6Month: getSpyPerf(126),
                performance9Month: getSpyPerf(189),
                performance12Month: getSpyPerf(252)
            };

            return {
                spyData: spyData.quotes,
                spyMap,
                spyPerformance, // Add to context
                vixContext: {
                    price: currentVix.close,
                    previousClose: prevVix.close,
                    vxvPrice: currentVix.close // simplified
                }
            };
        } catch (e) {
            console.error(`Market context fetch attempt ${attempt} failed:`, e.message);
            if (attempt < maxRetries) {
                await new Promise(r => setTimeout(r, 1000 * attempt)); // Exponential backoff
            }
        }
    }

    // Return fallback context to prevent complete failure
    console.warn("Using fallback market context after all retries failed");
    return {
        spyData: [],
        spyMap: {},
        spyPerformance: {
            performance3Month: 5,
            performance6Month: 10,
            performance9Month: 12,
            performance12Month: 15
        },
        vixContext: {
            price: 18.5,
            previousClose: 18.5,
            vxvPrice: 18.5
        },
        isFallback: true
    };
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

export async function getVixQuote() {
    const maxRetries = 3;
    let lastError = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const quote = await yahooFinance.quote('^VIX');
            if (quote && quote.regularMarketPrice) {
                return {
                    price: quote.regularMarketPrice,
                    open: quote.regularMarketOpen || quote.regularMarketPrice,
                    prevClose: quote.regularMarketPreviousClose || quote.regularMarketPrice
                };
            }
        } catch (e) {
            lastError = e;
            console.error(`VIX fetch attempt ${attempt} failed:`, e.message);
            if (attempt < maxRetries) {
                await new Promise(r => setTimeout(r, 1000 * attempt)); // Exponential backoff
            }
        }
    }

    // Return fallback data instead of null to prevent frontend crashes
    console.warn("Using fallback VIX data after all retries failed");
    return {
        price: 18.5, // Reasonable default VIX
        open: 18.5,
        prevClose: 18.5,
        isFallback: true
    };
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

    // --- Squeeze Logic ---
    const length = 20;
    const bb_mult = 2.0;
    const kc_mults = [1.0, 1.5, 2.0];

    const bbBasisValues = PandasLite.calculateSMAValues(closes, length);
    const stdevValues = PandasLite.calculateStdevValues(closes, length);

    // TR for KC
    const trValues = quotes.map((d, i) => {
        if (i === 0) return d.high - d.low;
        const pd = quotes[i - 1];
        return Math.max(d.high - d.low, Math.abs(d.high - pd.close), Math.abs(d.low - pd.close));
    });
    const devKCValues = PandasLite.calculateSMAValues(trValues, length);

    const last = closes.length - 1;
    const bbBasis = bbBasisValues[last];
    const stdev = stdevValues[last];
    const devKC = devKCValues[last];

    let squeezeStatus = 'No';
    if (bbBasis !== null && stdev !== null && devKC !== null) {
        const bbUpper = bbBasis + (bb_mult * stdev);
        const bbLower = bbBasis - (bb_mult * stdev);

        const kcUppers = kc_mults.map(m => bbBasis + (devKC * m));
        const kcLowers = kc_mults.map(m => bbBasis - (devKC * m));

        squeezeStatus = PandasLite.getSqueezeStatus(bbUpper, bbLower, kcUppers, kcLowers);
    }

    // RS Calculation (Performance Weighting)
    const getPerf = (days) => {
        if (quotes.length > days) {
            const pOld = quotes[quotes.length - 1 - days].close;
            return (currentPrice - pOld) / pOld;
        }
        return 0;
    };

    const perf3M = getPerf(63);
    const perf6M = getPerf(126);
    const perf9M = getPerf(189);
    const perf12M = getPerf(252);

    // Composite RS Score (Raw) - IBD Style weights
    const rawRsScore = (perf3M * 0.4) + (perf6M * 0.2) + (perf9M * 0.2) + (perf12M * 0.2);

    // RS Calculation
    let rsRating = 1.0;
    let rsMultiplier = 1.0;
    let rsLineSlope = 0.0;
    let rsOneDayChange = 0.0;
    let spyChange = 0.0;

    if (context && context.spyPerformance) {
        // Step 1: Stock Input Performance
        const calculatePerf = (days) => {
            if (quotes.length > days) {
                const pOld = quotes[quotes.length - 1 - days].close;
                return ((currentPrice - pOld) / pOld) * 100;
            }
            return 0;
        };

        const stockPerf = {
            performance3Month: calculatePerf(63),
            performance6Month: calculatePerf(126),
            performance9Month: calculatePerf(189),
            performance12Month: calculatePerf(252),
        };

        const spyPerf = context.spyPerformance;

        // Step 2: Convert to Relatives
        const stockRelatives = {
            pr63: 1 + (stockPerf.performance3Month / 100),
            pr126: 1 + (stockPerf.performance6Month / 100),
            pr189: 1 + (stockPerf.performance9Month / 100),
            pr252: 1 + (stockPerf.performance12Month / 100),
        };

        const spyRelatives = {
            pr63: 1 + (spyPerf.performance3Month / 100),
            pr126: 1 + (spyPerf.performance6Month / 100),
            pr189: 1 + (spyPerf.performance9Month / 100),
            pr252: 1 + (spyPerf.performance12Month / 100),
        };

        // Step 3 & 4: Weighted Performance
        const stockWeightedPerf =
            (stockRelatives.pr63 * 0.4) +
            (stockRelatives.pr126 * 0.2) +
            (stockRelatives.pr189 * 0.2) +
            (stockRelatives.pr252 * 0.2);

        const spyWeightedPerf =
            (spyRelatives.pr63 * 0.4) +
            (spyRelatives.pr126 * 0.2) +
            (spyRelatives.pr189 * 0.2) +
            (spyRelatives.pr252 * 0.2);

        // Step 5: Calculate RS Rating
        let calculatedRating = (spyWeightedPerf > 0) ? (stockWeightedPerf / spyWeightedPerf) : 1.0;
        rsRating = Math.max(0, Math.min(3, calculatedRating));

        // Update Internal fields for compatibility
        rsMultiplier = rsRating;

        // Calculate Trend Stats if possible for internal scoring
        if (context.spyMap) {
            const rsLine = [];
            quotes.forEach(q => {
                if (!q.date) return;
                const dStr = q.date.toISOString().split('T')[0];
                const spyClose = context.spyMap[dStr];
                if (spyClose) rsLine.push(q.close / spyClose);
            });
            if (rsLine.length > 21) {
                rsLineSlope = (rsLine[rsLine.length - 1] - rsLine[rsLine.length - 21]) / rsLine[rsLine.length - 21];
                rsOneDayChange = (rsLine[rsLine.length - 1] - rsLine[rsLine.length - 2]) / rsLine[rsLine.length - 2];
            }
        }

        // SPY Change for today
        if (context.spyData && context.spyData.length > 2) {
            const spyLast = context.spyData[context.spyData.length - 1].close;
            const spyPrev = context.spyData[context.spyData.length - 2].close;
            spyChange = ((spyLast - spyPrev) / spyPrev) * 100;
        }
    }

    // UD Ratio
    let upVol = 0, downVol = 0;
    for (let i = quotes.length - 20; i < quotes.length; i++) {
        if (i < 1) continue;
        if (closes[i] > closes[i - 1]) upVol += volumes[i];
        else if (closes[i] < closes[i - 1]) downVol += volumes[i];
    }
    const udRatio = downVol > 0 ? upVol / downVol : 5.0;

    // Prepare Extended Inputs for Enhanced Predictor
    const now = new Date();
    // Calculate actual minutes since market open (9:30 AM ET)
    const etString = now.toLocaleString("en-US", { timeZone: "America/New_York" });
    const etDate = new Date(etString);
    const etDay = etDate.getDay(); // 0 = Sun, 6 = Sat
    const etHour = etDate.getHours();
    const etMinute = etDate.getMinutes();
    const etMinutesOfDay = etHour * 60 + etMinute;
    const marketOpenMinutes = 9 * 60 + 30; // 9:30 AM = 570 minutes
    const marketCloseMinutes = 16 * 60; // 4:00 PM = 960 minutes
    
    let minutesSinceOpen;
    // Check if it's a weekday and within market hours
    if (etDay >= 1 && etDay <= 5 && etMinutesOfDay >= marketOpenMinutes && etMinutesOfDay < marketCloseMinutes) {
        // Market is open - calculate actual minutes since 9:30 AM
        minutesSinceOpen = etMinutesOfDay - marketOpenMinutes;
    } else {
        // Market is closed - use full day (390 minutes)
        minutesSinceOpen = 390;
    }

    const avgVol = PandasLite.mean(volumes.slice(-20));
    const curVol = volumes[volumes.length - 1];
    const relVol = IntradayPredictor.getProjectedRelativeVolume(curVol, avgVol, minutesSinceOpen);

    const percentChange = ((currentPrice - prevClose) / prevClose) * 100;
    const gapPercent = ((openPrice - prevClose) / prevClose) * 100;
    const roc = minutesSinceOpen > 0 ? percentChange / minutesSinceOpen : 0;

    // Extended Inputs
    const atr14Mean = PandasLite.mean(atrs.slice(-14));
    const atr14Std = PandasLite.std(atrs.slice(-14));

    let vixPctChange = 0;
    if (context && context.vixContext && context.vixContext.previousClose) {
        vixPctChange = ((context.vixContext.price - context.vixContext.previousClose) / context.vixContext.previousClose) * 100;
    }

    const predictorInputs = {
        openPrice,
        currentPrice,
        prevClose,
        vwap: quotes[quotes.length - 1].close, // Approx if real VWAP not avail, or (H+L+C)/3 earlier
        relativeVolume: relVol,
        percentADR,
        minutesSinceOpen,
        roc,
        gapPercent,
        atr14: atr,
        atr14Mean,
        atr14Std,
        vixPctChange,
        vixLevel: context && context.vixContext ? context.vixContext.price : undefined,
        todayHigh: high,
        todayLow: low
    };

    // Use enhanced predict
    const predictionResult = IntradayPredictor.predict(predictorInputs);
    const predChange = predictionResult.predictedEodChange;

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
        '50EMA (ATR)': Number(dist50_atr.toFixed(2)),
        // Send rsMultiplier (e.g. 1.25)
        'RS Rating': Number(rsMultiplier.toFixed(3)),

        // Internal fields
        rawRsScore,
        stockObj
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

    // We return directly using RS Multiplier, no batch percentile needed
    return results;
}


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
