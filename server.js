import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { fetchMarketContext, processBatch, getHoldings, ETFS } from './lib.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Serve static files from 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

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

// API Endpoint: Get Holdings (Top 50)
app.get('/api/holdings', async (req, res) => {
    try {
        const context = await getContext();
        if (!context) return res.status(500).json({ error: "Failed to fetch market context" });

        // Note: In a real app, we might want to cache the holdings list too
        // For this demo, we'll fetch them on demand but maybe limit the scope or cache it separately
        // Fetching ALL holdings is slow, so we might return a subset or pre-calculated list
        // For responsiveness, let's just process the ETFs for now to show immediate value,
        // OR process a small hardcoded list of popular tech stocks if ETFs are too boring.
        // Actually, let's just fetch the holdings but limit to first 10 ETFs to be faster?
        // Or just let it take its time.
        // Better: Return the calculation for a pre-defined "Watchlist" of popular stocks + holdings of top 3 ETFs

        const topEtfs = ETFS.slice(0, 5); // Just top 5 ETFs to get holdings from for speed
        const holdingsList = await getHoldings(topEtfs);

        // Limit to 50 random holdings to process for speed in this demo
        const limitedHoldings = holdingsList.slice(0, 50);

        const results = await processBatch(limitedHoldings, context);
        results.sort((a, b) => b['Quant Score'] - a['Quant Score']);
        res.json(results);
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: e.message });
    }
});

app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});
