import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { fetchMarketContext, processBatch, getHoldings, getVixQuote, getChartData, ETFS } from './lib.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Helper function to check if a ticker is a US-listed stock
// Returns false for tickers with foreign exchange suffixes like .TO, .T, .TW, .HK, .TA, etc.
function isUSStock(symbol) {
    if (!symbol || typeof symbol !== 'string') return false;
    // US stocks typically don't have dots in their symbols (except special cases starting with ^)
    if (symbol.includes('.') && !symbol.startsWith('^')) {
        return false;
    }
    return true;
}

// Serve static files from 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

// API Endpoint: Real-time VIX Status
app.get('/api/vix-status', async (req, res) => {
    try {
        const vixData = await getVixQuote();
        if (!vixData) return res.status(500).json({ error: "Failed to fetch VIX data" });
        res.json(vixData);
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: e.message });
    }
});

// API Endpoint: Historical Chart Data
app.get('/api/chart/:ticker', async (req, res) => {
    try {
        const { ticker } = req.params;
        const data = await getChartData(ticker);
        res.json(data);
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: e.message });
    }
});

// Cache for market context to avoid spamming Yahoo Finance
let marketContextCache = null;
let lastContextFetch = 0;
const CONTEXT_CACHE_DURATION = 1000 * 60 * 60; // 1 hour

async function getContext() {
    const now = Date.now();
    if (!marketContextCache || (now - lastContextFetch > CONTEXT_CACHE_DURATION)) {
        console.log("Refreshing market context...");
        marketContextCache = await fetchMarketContext();
        lastContextFetch = now;
    }
    return marketContextCache;
}

// API Endpoint: Get ETF Rankings
app.get('/api/etfs', async (req, res) => {
    try {
        const context = await getContext();
        if (!context) return res.status(500).json({ error: "Failed to fetch market context" });

        const results = await processBatch(ETFS, context);
        results.sort((a, b) => b['Quant Score'] - a['Quant Score']);
        res.json(results);
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: e.message });
    }
});

// Helper to get a consistent universe of stocks (ETFs + Top Holdings)
// Caches the list of tickers to avoid re-scraping HTML for holdings every time
let tickerCache = {
    list: [],
    lastFetch: 0
};
const TICKER_CACHE_DURATION = 1000 * 60 * 60 * 12; // 12 hours

async function getTrackedStocks() {
    const now = Date.now();
    if (tickerCache.list.length > 0 && (now - tickerCache.lastFetch < TICKER_CACHE_DURATION)) {
        return tickerCache.list;
    }

    console.log("Refreshing Stock Universe...");
    const topEtfs = ETFS.slice(0, 5);
    let holdings = [];
    try {
        holdings = await getHoldings(topEtfs);
    } catch (e) {
        console.error("Failed to fetch holdings", e);
    }

    // Combine ETFs and Holdings, deduplicate
    const combined = new Set([...ETFS, ...holdings]);
    // Limit to reasonable number for demo performance if needed, or take all
    // Let's take top 100 to ensure we have good "movers" candidates
    const items = Array.from(combined).slice(0, 100);

    tickerCache = { list: items, lastFetch: now };
    return items;
}

// API Endpoint: Get Holdings
app.get('/api/holdings', async (req, res) => {
    try {
        const context = await getContext();
        if (!context) return res.status(500).json({ error: "Failed to fetch market context" });

        const tickers = await getTrackedStocks();
        // Filter out ETFs from this list if we only want "Holdings" (Stocks)
        // But for now, let's just exclude the main ETFS list to allow "Stocks" focus
        const etfSet = new Set(ETFS);
        const stocksOnly = tickers.filter(t => !etfSet.has(t));

        // Process a subset for the "Top Opportunities" table (e.g. random 50 or top 50)
        // For consistency, let's just take the first 50
        const subset = stocksOnly.slice(0, 50);

        const results = await processBatch(subset, context);
        // Filter out any non-US stocks from results
        const usResults = results.filter(item => isUSStock(item.ticker));
        usResults.sort((a, b) => b['Quant Score'] - a['Quant Score']);
        res.json(usResults);
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: e.message });
    }
});

// Helper to check if market is open (NYSE: 9:30 - 16:00 ET, Mon-Fri)
function isMarketOpen() {
    const now = new Date();
    const etString = now.toLocaleString("en-US", { timeZone: "America/New_York" });
    const etDate = new Date(etString);

    const day = etDate.getDay(); // 0 = Sun, 6 = Sat
    const hour = etDate.getHours();
    const minute = etDate.getMinutes();
    const minutesOfDay = hour * 60 + minute;

    // Weekend check
    if (day === 0 || day === 6) return false;

    // Time check (9:30 - 16:00) => 570 - 960
    return minutesOfDay >= 570 && minutesOfDay < 960;
}

// API Endpoint: Top Movers (Auto-Switching)
app.get('/api/movers', async (req, res) => {
    try {
        const context = await getContext();
        if (!context) return res.status(500).json({ error: "Failed to fetch market context" });

        const tickers = await getTrackedStocks();
        const results = await processBatch(tickers, context);

        // Filter out non-US stocks first
        const usResults = results.filter(item => isUSStock(item.ticker));
        // Then filter for high volume interest: RVol > 1
        const highVol = usResults.filter(item => item.RVol > 1.0);

        const open = isMarketOpen();
        let movers = [];

        if (open) {
            // MARKET OPEN: Remaining Potential
            movers = [...highVol].sort((a, b) => {
                const potA = a['%Pred'] - a.percentChange;
                const potB = b['%Pred'] - b.percentChange;
                return potB - potA;
            }).slice(0, 10);
        } else {
            // MARKET CLOSED: Top Gainers
            movers = [...highVol].sort((a, b) => b.percentChange - a.percentChange).slice(0, 10);
        }

        res.json({
            status: open ? 'OPEN' : 'CLOSED',
            data: movers
        });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: e.message });
    }
});

app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});
