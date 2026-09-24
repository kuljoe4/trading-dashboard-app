const fs = require('fs');
let content = fs.readFileSync('backend/node/src/lib/binanceClientFactory.ts', 'utf-8');
const search = `    // ARCHITECTURAL FIX: Override SDK's internal URL building to support dedicated gateways
    // /private (for listenKey), /market (for anonymous market streams), and /public (HF data)\n`;
content = content.replace(search, '');
fs.writeFileSync('backend/node/src/lib/binanceClientFactory.ts', content);
