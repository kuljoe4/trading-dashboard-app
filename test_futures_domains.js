const WebSocket = require('ws');

const domains = [
    'fstream.binance.com',
    'fstream2.binance.com',
    'fstream3.binance.com',
    'fstream4.binance.com'
];

async function testDomain(domain) {
    const url = `wss://${domain}/ws/btcusdt@markPrice`;
    console.log(`Testing ${url}...`);
    
    return new Promise((resolve) => {
        const ws = new WebSocket(url);
        const timeout = setTimeout(() => {
            console.log(`[${domain}] Timeout`);
            ws.terminate();
            resolve(false);
        }, 5000);

        ws.on('open', () => {
            console.log(`[${domain}] Connected! Waiting for message...`);
        });

        ws.on('message', (data) => {
            console.log(`[${domain}] Received message!`);
            clearTimeout(timeout);
            ws.close();
            resolve(true);
        });

        ws.on('error', (err) => {
            console.log(`[${domain}] Error: ${err.message}`);
            clearTimeout(timeout);
            resolve(false);
        });
    });
}

async function run() {
    for (const domain of domains) {
        const success = await testDomain(domain);
        if (success) {
            console.log(`>>> SUCCESS with ${domain} <<<`);
            break;
        }
    }
}

run();
