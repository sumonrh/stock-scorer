
import fs from 'fs';
import { Buffer } from 'buffer';

try {
    const buf = fs.readFileSync('lib.js');
    // Search for the unique comment at the end of the valid code
    const pattern = Buffer.from('// We return directly using RS Multiplier, no batch percentile needed');
    const idx = buf.indexOf(pattern);

    if (idx !== -1) {
        // Find the next '}' after this.
        const rest = buf.subarray(idx);
        const closeIdx = rest.indexOf('}');

        if (closeIdx !== -1) {
            const cutPoint = idx + closeIdx + 1;
            const cleanBuf = buf.subarray(0, cutPoint);
            const appendBuf = fs.readFileSync('append_chart.js');

            const finalBuf = Buffer.concat([cleanBuf, Buffer.from('\n\n'), appendBuf]);
            fs.writeFileSync('lib.js', finalBuf);
            console.log("Restored lib.js via Buffer");
        } else {
            console.log("Could not find closing brace");
        }
    } else {
        console.log("Could not find pattern");
    }
} catch (e) {
    console.error(e);
}
