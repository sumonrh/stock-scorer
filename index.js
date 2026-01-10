import colors from 'colors';
import Table from 'cli-table3';
import {
    fetchMarketContext,
    processBatch,
    getHoldings,
    ETFS
} from './lib.js';

function printTable(data, title) {
    if (!data.length) return;
    console.log(`\n--- ${title} ---`.cyan.bold);

    const keys = [
        'Quant Score', 'ticker', 'price', 'percentChange', 'RVol', '%Pred',
        'RS Delta', 'udRatio', 'squeezeStatus', 'atr', 'percentADR',
        '10EMA (ATR)', '20EMA (ATR)', '50EMA (ATR)'
    ];

    const table = new Table({
        head: keys.map(k => k.cyan),
        style: { compact: true }
    });

    data.forEach(row => {
        table.push(keys.map(k => row[k] ?? ''));
    });

    console.log(table.toString());
}

// --- MAIN ---

(async () => {
    const context = await fetchMarketContext();
    if (!context) return;

    // 1. ETFs
    console.log("\n--- PROCESSING ETFS ---");
    const etfResults = await processBatch(ETFS, context);
    etfResults.sort((a, b) => b['Quant Score'] - a['Quant Score']);
    printTable(etfResults, "ETF RANKING");

    // 2. Holdings
    const holdingsList = await getHoldings(ETFS);
    console.log(`Fetching data for ${holdingsList.length} holdings (this may take a moment)...`);

    // Process in smaller batches
    let allHoldingsResults = [];
    const batchSize = 10;
    for (let i = 0; i < holdingsList.length; i += batchSize) {
        const batch = holdingsList.slice(i, i + batchSize);
        const res = await processBatch(batch, context);
        allHoldingsResults = allHoldingsResults.concat(res);
        process.stdout.write(".");
    }

    allHoldingsResults.sort((a, b) => b['Quant Score'] - a['Quant Score']);
    printTable(allHoldingsResults.slice(0, 50), "TOP 50 HOLDINGS");

})();