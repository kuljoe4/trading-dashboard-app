import { DerivativesTradingUsdsFutures } from '@binance/derivatives-trading-usds-futures';

async function main() {
  const client = new DerivativesTradingUsdsFutures({
    configurationRestAPI: {
      apiKey: 'test',
      apiSecret: 'test',
      basePath: 'https://fapi.binance.com'
    }
  });

  console.log('Methods on restAPI:');
  const methods = Object.getOwnPropertyNames(Object.getPrototypeOf(client.restAPI));
  console.log(methods.filter(m => m.toLowerCase().includes('bracket') || m.toLowerCase().includes('leverage')));
}

main().catch(console.error);
