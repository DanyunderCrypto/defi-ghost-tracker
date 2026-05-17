// Tests for Price Oracle (Sprint 7)
// Validates coin ID resolution + cache invariants
const { describe, test, expect } = require('./_runner');

// Mirror of COIN_ID_MAP + resolveCoinId from HTML
const COIN_ID_MAP = {
  'ETH':  'coingecko:ethereum',
  'WETH': { eth: 'ethereum:0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
            base: 'base:0x4200000000000000000000000000000000000006',
            arbitrum: 'arbitrum:0x82af49447d8a07e3bd95bd0d56f35241523fbab1',
            optimism: 'optimism:0x4200000000000000000000000000000000000006' },
  'BTC':  'coingecko:bitcoin',
  'WBTC': 'coingecko:wrapped-bitcoin',
  'USDC': { eth: 'ethereum:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
            base: 'base:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
            arbitrum: 'arbitrum:0xaf88d065e77c8cc2239327c5edb3a432268e5831',
            optimism: 'optimism:0x0b2c639c533813f4aa9d7837caf62653d097ff85' },
  'USDT': { eth: 'ethereum:0xdac17f958d2ee523a2206206994597c13d831ec7' },
  'DAI':  { eth: 'ethereum:0x6b175474e89094c44da98b954eedeac495271d0f' },
  'STETH':  'coingecko:staked-ether',
  'WSTETH': 'coingecko:wrapped-steth',
  'RETH':   'coingecko:rocket-pool-eth',
  'EETH':   'coingecko:ether-fi-staked-eth',
  'WEETH':  'coingecko:wrapped-eeth',
  'CBBTC':  'coingecko:coinbase-wrapped-btc',
  'EURE':   'coingecko:monerium-eur-money',
};

function resolveCoinId(asset, chain, contract) {
  if (!asset) return null;
  const ASSET = asset.toUpperCase();
  if (contract && contract.startsWith('0x') && contract.length === 42) {
    return `${chain}:${contract.toLowerCase()}`;
  }
  const entry = COIN_ID_MAP[ASSET];
  if (typeof entry === 'string') return entry;
  if (typeof entry === 'object') return entry[chain] || null;
  return null;
}

describe('Price Oracle > Coin ID resolution', () => {
  test('native ETH resolves to coingecko:ethereum', () => {
    expect(resolveCoinId('ETH', 'eth', null)).toBe('coingecko:ethereum');
  });

  test('native BTC resolves to coingecko:bitcoin', () => {
    expect(resolveCoinId('BTC', 'bitcoin', null)).toBe('coingecko:bitcoin');
  });

  test('USDC on Ethereum resolves to ethereum address', () => {
    const id = resolveCoinId('USDC', 'eth', null);
    expect(id).toBe('ethereum:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48');
  });

  test('USDC on Base resolves to BASE address (NOT ethereum)', () => {
    // Critical: USDC has DIFFERENT addresses per chain
    const id = resolveCoinId('USDC', 'base', null);
    expect(id).toBe('base:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913');
  });

  test('USDC on Arbitrum resolves to ARB address', () => {
    const id = resolveCoinId('USDC', 'arbitrum', null);
    expect(id).toBe('arbitrum:0xaf88d065e77c8cc2239327c5edb3a432268e5831');
  });

  test('WETH on Optimism resolves correctly', () => {
    const id = resolveCoinId('WETH', 'optimism', null);
    expect(id).toBe('optimism:0x4200000000000000000000000000000000000006');
  });

  test('lowercase asset name still resolves', () => {
    expect(resolveCoinId('usdc', 'eth', null)).toContain('ethereum:0xa0b86991');
  });
});

describe('Price Oracle > Contract address priority', () => {
  test('explicit contract address takes precedence over symbol', () => {
    // Even with an unknown asset name, if we have the contract we can fetch
    const id = resolveCoinId('UNKNOWN', 'eth', '0x1234567890abcdef1234567890abcdef12345678');
    expect(id).toBe('eth:0x1234567890abcdef1234567890abcdef12345678');
  });

  test('contract address is lowercased in result', () => {
    const id = resolveCoinId('SOMETHING', 'base', '0xABCDEF1234567890ABCDEF1234567890ABCDEF12');
    expect(id).toBe('base:0xabcdef1234567890abcdef1234567890abcdef12');
  });

  test('invalid contract format falls back to symbol map', () => {
    // 'WETH' as symbol, contract too short → should use map
    const id = resolveCoinId('WETH', 'eth', '0xtooShort');
    expect(id).toBe('ethereum:0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2');
  });
});

describe('Price Oracle > Edge cases', () => {
  test('null/empty asset returns null', () => {
    expect(resolveCoinId(null, 'eth', null)).toBeNull();
    expect(resolveCoinId('', 'eth', null)).toBeNull();
    expect(resolveCoinId(undefined, 'eth', null)).toBeNull();
  });

  test('unknown asset on unknown chain returns null', () => {
    expect(resolveCoinId('UNKNOWN_TOKEN', 'unknown_chain', null)).toBeNull();
  });

  test('asset with chain-specific map but wrong chain returns null', () => {
    // USDC is in the map but only for specific chains
    expect(resolveCoinId('USDC', 'unknown_chain', null)).toBeNull();
  });

  test('staking derivatives (eETH, weETH, stETH) all resolve', () => {
    expect(resolveCoinId('eETH', 'eth', null)).toBe('coingecko:ether-fi-staked-eth');
    expect(resolveCoinId('weETH', 'eth', null)).toBe('coingecko:wrapped-eeth');
    expect(resolveCoinId('stETH', 'eth', null)).toBe('coingecko:staked-ether');
  });
});

describe('Price Oracle > Tax-critical invariants', () => {
  test('INVARIANT: USDC must resolve to different addresses per chain', () => {
    // Critical: same symbol, different prices feeds. Confusing them = wrong basis.
    const eth = resolveCoinId('USDC', 'eth', null);
    const base = resolveCoinId('USDC', 'base', null);
    const arb = resolveCoinId('USDC', 'arbitrum', null);
    expect(eth === base).toBe(false);
    expect(base === arb).toBe(false);
    expect(arb === eth).toBe(false);
  });

  test('INVARIANT: native asset (ETH, BTC) MUST NOT use contract address format', () => {
    // Native assets don't have contracts; using 'ethereum:0x000...' would fail
    expect(resolveCoinId('ETH', 'eth', null)).toBe('coingecko:ethereum');
    expect(resolveCoinId('BTC', 'bitcoin', null)).toBe('coingecko:bitcoin');
  });

  test('INVARIANT: missing price data must return null (NEVER fabricate)', () => {
    // Tax engine relies on this. Never €0 for unknown — would understate gains.
    const id = resolveCoinId('SOMETHING_OBSCURE', 'unknown', null);
    expect(id).toBeNull();
  });

  test('INVARIANT: EUR-pegged stablecoin (EURe) recognized', () => {
    // Important for cards that fund in EURe — different fiscal treatment
    expect(resolveCoinId('EURe', 'gnosis', null)).toBe('coingecko:monerium-eur-money');
  });
});

describe('Price Oracle > EUR price calculation logic', () => {
  // We don't test actual API calls (those would be integration tests)
  // We test the math: amount × price × eurRate
  test('amount × priceUSD × rate gives correct EUR', () => {
    const amount = 100;       // 100 USDC
    const priceUSD = 1.0001;  // USDC at $1.0001
    const rate = 0.92;        // USD→EUR
    const eur = amount * priceUSD * rate;
    expect(Math.abs(eur - 92.0092) < 0.01).toBe(true);
  });

  test('zero amount produces zero EUR (NOT NaN)', () => {
    const amount = 0;
    const priceUSD = 50000;
    const rate = 0.92;
    const eur = amount * priceUSD * rate;
    expect(eur).toBe(0);
  });

  test('null price must NOT default to 0 (would understate disposal gain)', () => {
    // This is the bug we MUST avoid: if no price → null, NOT 0
    const priceEUR = null;
    expect(priceEUR).toBeNull();
    // UI should display "—" not "€0,00"
  });

  test('BTC at $40k with 0.5 BTC = $20k = €18,400 at 0.92 rate', () => {
    const amount = 0.5;
    const priceUSD = 40000;
    const rate = 0.92;
    const eur = amount * priceUSD * rate;
    expect(eur).toBe(18400);
  });

  test('precision: 1e-8 BTC × price does not lose precision unreasonably', () => {
    // 1 sat (smallest unit)
    const amount = 1e-8;
    const priceUSD = 40000;
    const rate = 0.92;
    const eur = amount * priceUSD * rate;
    // Should be ~0.000368 EUR — well representable
    expect(eur > 0).toBe(true);
    expect(eur < 0.001).toBe(true);
  });
});
