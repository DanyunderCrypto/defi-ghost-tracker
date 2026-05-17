// Tests for Address Book + Event Enrichment (Sprint 5)
// Validates protocol identification and action derivation
const { describe, test, expect } = require('./_runner');

// Mirror of relevant ADDRESS_BOOK entries (synced with HTML for testing)
const ADDRESS_BOOK = {
  // Lending
  '0x87870bca3f3fd6335c3f4ce8392d69350b4fa4e2': { protocol: 'AAVE V3', type: 'lending', name: 'Pool', chain: 'eth' },
  '0xa238dd80c259a72e81d7e4664a9801593f98d1c5': { protocol: 'AAVE V3', type: 'lending', name: 'Pool', chain: 'base' },
  '0xbbbbbbbbbb9cc5e90e3b3af64bdaf62c37eeffcb': { protocol: 'Morpho Blue', type: 'lending', name: 'MorphoBlue', chain: 'eth' },
  // DEX
  '0x3fc91a3afd70395cd496c647d5a6cc9d4b2b7fad': { protocol: 'Uniswap', type: 'dex', name: 'UniversalRouter', chain: 'eth' },
  '0x1111111254eeb25477b68fb85ed929f73a960582': { protocol: '1inch', type: 'dex', name: 'AggregationRouterV5', chain: 'eth' },
  // Staking
  '0xae7ab96520de3a18e5e111b5eaab095312d7fe84': { protocol: 'Lido', type: 'staking', name: 'stETH', chain: 'eth' },
  // Bridge
  '0x8731d54e9d02c286767d56ac03e8037c07e01e98': { protocol: 'Stargate', type: 'bridge', name: 'Router', chain: 'eth' },
  // CEX
  '0x28c6c06298d514db089934071355e5743bf21d60': { protocol: 'Binance', type: 'cex', name: 'Hot Wallet 14', chain: 'eth' },
  // WETH wrap
  '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2': { protocol: 'WETH', type: 'wrap', name: 'WETH', chain: 'eth' },
};

function lookupAddress(address) {
  if (!address) return null;
  return ADDRESS_BOOK[String(address).toLowerCase()] || null;
}

function deriveAction(event, protocolInfo) {
  const dir = event.direction;
  const t = protocolInfo.type;

  if (t === 'lending') {
    if (dir === 'out') return 'supply';
    if (dir === 'in')  return 'withdraw';
  }
  if (t === 'dex') return 'swap';
  if (t === 'staking') {
    if (dir === 'out') return 'stake';
    if (dir === 'in')  return 'unstake';
  }
  if (t === 'bridge') return 'bridge';
  if (t === 'cex') {
    if (dir === 'out') return 'deposit_to_cex';
    if (dir === 'in')  return 'withdraw_from_cex';
  }
  if (t === 'wrap') {
    if (dir === 'out') return 'wrap';
    if (dir === 'in')  return 'unwrap';
  }
  if (t === 'card') {
    if (dir === 'out') return 'fund_card';
    if (dir === 'in')  return 'card_refund';
  }
  return 'unknown_action';
}

function enrichEvent(event) {
  if (!event || !event.counterparty?.address) return event;
  const info = lookupAddress(event.counterparty.address);
  if (!info) {
    event.counterparty.labeled = '';
    return event;
  }
  event.counterparty.labeled = `${info.protocol}${info.name ? ' · ' + info.name : ''}`;
  event.counterparty.isContract = true;
  event.protocol = info.protocol;
  event.protocolType = info.type;
  event.action = deriveAction(event, info);
  return event;
}

// Helper to build a test event
function buildEvent(counterpartyAddr, direction = 'out', chain = 'eth') {
  return {
    id: 'test',
    chain,
    direction,
    counterparty: { address: counterpartyAddr },
    protocol: undefined,
    protocolType: undefined,
    action: undefined,
  };
}

describe('Address Book > Lookup', () => {
  test('AAVE V3 Pool on Ethereum is recognized', () => {
    const info = lookupAddress('0x87870bca3f3fd6335c3f4ce8392d69350b4fa4e2');
    expect(info).toBeTruthy();
    expect(info.protocol).toBe('AAVE V3');
    expect(info.type).toBe('lending');
  });

  test('AAVE V3 Pool on Base is recognized (different address)', () => {
    const info = lookupAddress('0xa238dd80c259a72e81d7e4664a9801593f98d1c5');
    expect(info).toBeTruthy();
    expect(info.chain).toBe('base');
  });

  test('case-insensitive lookup (uppercase address)', () => {
    const info = lookupAddress('0x87870BCA3F3FD6335C3F4CE8392D69350B4FA4E2');
    expect(info).toBeTruthy();
    expect(info.protocol).toBe('AAVE V3');
  });

  test('unknown address returns null', () => {
    const info = lookupAddress('0x0000000000000000000000000000000000000000');
    expect(info).toBeNull();
  });

  test('null/empty input returns null', () => {
    expect(lookupAddress(null)).toBeNull();
    expect(lookupAddress('')).toBeNull();
    expect(lookupAddress(undefined)).toBeNull();
  });
});

describe('Event Enrichment > Lending (AAVE)', () => {
  test('OUT to AAVE Pool = supply', () => {
    const e = buildEvent('0x87870bca3f3fd6335c3f4ce8392d69350b4fa4e2', 'out');
    enrichEvent(e);
    expect(e.protocol).toBe('AAVE V3');
    expect(e.protocolType).toBe('lending');
    expect(e.action).toBe('supply');
    expect(e.counterparty.labeled).toBe('AAVE V3 · Pool');
    expect(e.counterparty.isContract).toBe(true);
  });

  test('IN from AAVE Pool = withdraw', () => {
    const e = buildEvent('0x87870bca3f3fd6335c3f4ce8392d69350b4fa4e2', 'in');
    enrichEvent(e);
    expect(e.action).toBe('withdraw');
  });

  test('Morpho Blue recognized', () => {
    const e = buildEvent('0xbbbbbbbbbb9cc5e90e3b3af64bdaf62c37eeffcb', 'out');
    enrichEvent(e);
    expect(e.protocol).toBe('Morpho Blue');
    expect(e.action).toBe('supply');
  });
});

describe('Event Enrichment > DEX', () => {
  test('Uniswap Universal Router interaction = swap', () => {
    const e = buildEvent('0x3fc91a3afd70395cd496c647d5a6cc9d4b2b7fad', 'out');
    enrichEvent(e);
    expect(e.protocol).toBe('Uniswap');
    expect(e.protocolType).toBe('dex');
    expect(e.action).toBe('swap');
  });

  test('1inch router = swap', () => {
    const e = buildEvent('0x1111111254eeb25477b68fb85ed929f73a960582', 'out');
    enrichEvent(e);
    expect(e.protocol).toBe('1inch');
    expect(e.action).toBe('swap');
  });

  test('IN from DEX is also classified as swap (not withdraw)', () => {
    // DEX direction-agnostic: swap is swap
    const e = buildEvent('0x3fc91a3afd70395cd496c647d5a6cc9d4b2b7fad', 'in');
    enrichEvent(e);
    expect(e.action).toBe('swap');
  });
});

describe('Event Enrichment > Staking', () => {
  test('OUT to Lido = stake', () => {
    const e = buildEvent('0xae7ab96520de3a18e5e111b5eaab095312d7fe84', 'out');
    enrichEvent(e);
    expect(e.protocol).toBe('Lido');
    expect(e.protocolType).toBe('staking');
    expect(e.action).toBe('stake');
  });

  test('IN from Lido = unstake', () => {
    const e = buildEvent('0xae7ab96520de3a18e5e111b5eaab095312d7fe84', 'in');
    enrichEvent(e);
    expect(e.action).toBe('unstake');
  });
});

describe('Event Enrichment > Bridges', () => {
  test('Stargate Router = bridge (direction-agnostic)', () => {
    const eOut = buildEvent('0x8731d54e9d02c286767d56ac03e8037c07e01e98', 'out');
    enrichEvent(eOut);
    expect(eOut.action).toBe('bridge');
    expect(eOut.protocolType).toBe('bridge');
  });
});

describe('Event Enrichment > CEX', () => {
  test('OUT to Binance hot wallet = deposit_to_cex', () => {
    const e = buildEvent('0x28c6c06298d514db089934071355e5743bf21d60', 'out');
    enrichEvent(e);
    expect(e.protocol).toBe('Binance');
    expect(e.action).toBe('deposit_to_cex');
  });

  test('IN from Binance hot wallet = withdraw_from_cex', () => {
    const e = buildEvent('0x28c6c06298d514db089934071355e5743bf21d60', 'in');
    enrichEvent(e);
    expect(e.action).toBe('withdraw_from_cex');
  });
});

describe('Event Enrichment > Wrap/Unwrap', () => {
  test('OUT to WETH contract = wrap (ETH → WETH)', () => {
    const e = buildEvent('0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2', 'out');
    enrichEvent(e);
    expect(e.protocol).toBe('WETH');
    expect(e.action).toBe('wrap');
  });

  test('IN from WETH contract = unwrap', () => {
    const e = buildEvent('0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2', 'in');
    enrichEvent(e);
    expect(e.action).toBe('unwrap');
  });
});

describe('Event Enrichment > Edge cases', () => {
  test('unknown counterparty leaves protocol undefined', () => {
    const e = buildEvent('0x0000000000000000000000000000000000000000', 'out');
    enrichEvent(e);
    expect(e.protocol).toBe(undefined);
    expect(e.action).toBe(undefined);
    expect(e.counterparty.labeled).toBe('');
  });

  test('missing counterparty does not throw', () => {
    const e = { direction: 'out', counterparty: { address: '' } };
    enrichEvent(e);  // should not throw
    expect(e.protocol).toBe(undefined);
  });

  test('null event is safe', () => {
    enrichEvent(null);  // should not throw
    expect(true).toBe(true);
  });

  test('labeled string format is "Protocol · Name"', () => {
    const e = buildEvent('0x87870bca3f3fd6335c3f4ce8392d69350b4fa4e2', 'out');
    enrichEvent(e);
    expect(e.counterparty.labeled).toBe('AAVE V3 · Pool');
  });
});

describe('Address Book > Tax-critical invariants', () => {
  test('INVARIANT: WETH wrap/unwrap is NEVER classified as dex/swap', () => {
    // Critical because wrap is non-taxable (permuta) but swap might be disposal
    const eWrap = buildEvent('0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2', 'out');
    enrichEvent(eWrap);
    expect(eWrap.protocolType).toBe('wrap');
    expect(eWrap.action === 'swap').toBe(false);
  });

  test('INVARIANT: Lending pools are NEVER classified as dex', () => {
    // Supply to AAVE is NOT a disposal — must not be confused with swap
    const eSupply = buildEvent('0x87870bca3f3fd6335c3f4ce8392d69350b4fa4e2', 'out');
    enrichEvent(eSupply);
    expect(eSupply.protocolType).toBe('lending');
    expect(eSupply.action === 'swap').toBe(false);
  });

  test('INVARIANT: CEX deposits/withdrawals are flagged distinctly', () => {
    // CEX deposit/withdrawal needs special FIFO treatment (CEX has own basis tracking)
    const eDep = buildEvent('0x28c6c06298d514db089934071355e5743bf21d60', 'out');
    enrichEvent(eDep);
    expect(eDep.protocolType).toBe('cex');
    expect(eDep.action).toBe('deposit_to_cex');
  });

  test('INVARIANT: Bridges always classified the same way regardless of direction', () => {
    // Bridge in == bridge out, both are transfer_internal for tax purposes
    const eOut = buildEvent('0x8731d54e9d02c286767d56ac03e8037c07e01e98', 'out');
    const eIn = buildEvent('0x8731d54e9d02c286767d56ac03e8037c07e01e98', 'in');
    enrichEvent(eOut);
    enrichEvent(eIn);
    expect(eOut.protocolType).toBe('bridge');
    expect(eIn.protocolType).toBe('bridge');
  });
});
