// Tests for Universal Indexer (Sprint 4)
// Validates the normalization + classification logic of Alchemy transfers
const { describe, test, expect } = require('./_runner');

// Mirror of _normalizeTransfer from HTML (kept in sync manually for Sprint 4)
// In Sprint 2.5 we'll properly extract via sync-from-html.py
function normalizeTransfer(raw, chain, walletAddress) {
  const addrLower = walletAddress.toLowerCase();
  const fromLower = (raw.from || '').toLowerCase();
  const toLower = (raw.to || '').toLowerCase();

  let direction = 'unknown';
  if (fromLower === addrLower && toLower === addrLower) direction = 'self';
  else if (fromLower === addrLower) direction = 'out';
  else if (toLower === addrLower) direction = 'in';

  const counterpartyAddr = direction === 'in' ? raw.from : direction === 'out' ? raw.to : '';

  let amount = 0;
  if (raw.value !== null && raw.value !== undefined) {
    amount = parseFloat(raw.value) || 0;
  }

  const blockTimestamp = raw.metadata?.blockTimestamp;
  let ts = 0, dateStr = '';
  if (blockTimestamp) {
    ts = Math.floor(new Date(blockTimestamp).getTime() / 1000);
    dateStr = blockTimestamp.slice(0, 10);
  }

  return {
    id: `evm:${chain}:${walletAddress}:${raw.hash}:${raw.uniqueId || raw.asset || ''}`,
    chain,
    txHash: raw.hash,
    blockNumber: parseInt(raw.blockNum, 16),
    timestamp: ts,
    date: dateStr,
    walletAddress: addrLower,
    type: 'unknown',
    direction,
    asset: raw.asset || 'ETH',
    assetContract: raw.rawContract?.address || '',
    amount,
    decimals: parseInt(raw.rawContract?.decimal || '0x12', 16) || 18,
    counterparty: {
      address: counterpartyAddr,
      labeled: '',
      isContract: false,
    },
    category: raw.category,
    _direction: raw._direction,
  };
}

function classifyTxGroup(eventsInTx) {
  if (eventsInTx.length === 0) return;
  const ins = eventsInTx.filter(e => e.direction === 'in');
  const outs = eventsInTx.filter(e => e.direction === 'out');
  const selfs = eventsInTx.filter(e => e.direction === 'self');
  let txType = 'unknown';
  if (selfs.length > 0 && ins.length === 0 && outs.length === 0) txType = 'self_transfer';
  else if (ins.length > 0 && outs.length > 0) txType = 'swap';
  else if (ins.length > 0) txType = 'receive';
  else if (outs.length > 0) txType = 'send';
  for (const e of eventsInTx) e.type = txType;
}

// Sample raw Alchemy transfers (sanitized — based on real Alchemy responses)
const MY_WALLET = '0xc3673adca09356f1b91add3d64d1cfe1f5431d7c';
const SAMPLE_INCOMING_USDC = {
  blockNum: '0xed3b7e',
  hash: '0xabc123def456abc123def456abc123def456abc123def456abc123def456abcd',
  from: '0x3fc91a3afd70395cd496c647d5a6cc9d4b2b7fad',
  to: MY_WALLET,
  value: 1000.0,
  asset: 'USDC',
  category: 'erc20',
  rawContract: { address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', decimal: '0x6' },
  metadata: { blockTimestamp: '2024-03-15T10:30:00.000Z' },
  uniqueId: 'unique-1',
};
const SAMPLE_OUTGOING_ETH = {
  blockNum: '0xed3b7e',
  hash: '0xabc123def456abc123def456abc123def456abc123def456abc123def456abcd',
  from: MY_WALLET,
  to: '0x3fc91a3afd70395cd496c647d5a6cc9d4b2b7fad',
  value: 0.5,
  asset: 'ETH',
  category: 'external',
  rawContract: { value: null, address: null, decimal: null },
  metadata: { blockTimestamp: '2024-03-15T10:30:00.000Z' },
  uniqueId: 'unique-2',
};
const SAMPLE_SELF_TRANSFER = {
  blockNum: '0xed3b80',
  hash: '0xdef789abc012def789abc012def789abc012def789abc012def789abc012defg',
  from: MY_WALLET,
  to: MY_WALLET,
  value: 100.0,
  asset: 'USDC',
  category: 'erc20',
  rawContract: { decimal: '0x6' },
  metadata: { blockTimestamp: '2024-04-01T08:00:00.000Z' },
};

describe('Indexer › Transfer normalization', () => {
  test('incoming USDC transfer is marked as in', () => {
    const e = normalizeTransfer(SAMPLE_INCOMING_USDC, 'eth', MY_WALLET);
    expect(e.direction).toBe('in');
    expect(e.chain).toBe('eth');
    expect(e.asset).toBe('USDC');
    expect(e.amount).toBe(1000);
    expect(e.counterparty.address).toBe('0x3fc91a3afd70395cd496c647d5a6cc9d4b2b7fad');
  });

  test('outgoing ETH transfer is marked as out', () => {
    const e = normalizeTransfer(SAMPLE_OUTGOING_ETH, 'eth', MY_WALLET);
    expect(e.direction).toBe('out');
    expect(e.asset).toBe('ETH');
    expect(e.amount).toBe(0.5);
  });

  test('self-transfer (from == to == wallet) is marked as self', () => {
    const e = normalizeTransfer(SAMPLE_SELF_TRANSFER, 'eth', MY_WALLET);
    expect(e.direction).toBe('self');
  });

  test('date parsed from blockTimestamp', () => {
    const e = normalizeTransfer(SAMPLE_INCOMING_USDC, 'eth', MY_WALLET);
    expect(e.date).toBe('2024-03-15');
    expect(e.timestamp).toBeGreaterThan(1700000000);
  });

  test('id is deterministic and unique', () => {
    const e1 = normalizeTransfer(SAMPLE_INCOMING_USDC, 'eth', MY_WALLET);
    const e2 = normalizeTransfer(SAMPLE_INCOMING_USDC, 'eth', MY_WALLET);
    expect(e1.id).toBe(e2.id);
    const e3 = normalizeTransfer(SAMPLE_OUTGOING_ETH, 'eth', MY_WALLET);
    expect(e1.id === e3.id).toBe(false);
  });

  test('block number parsed from hex', () => {
    const e = normalizeTransfer(SAMPLE_INCOMING_USDC, 'eth', MY_WALLET);
    expect(e.blockNumber).toBe(15547262);  // 0xed3b7e
  });

  test('case-insensitive wallet address matching', () => {
    const upperRaw = { ...SAMPLE_INCOMING_USDC, to: MY_WALLET.toUpperCase() };
    const e = normalizeTransfer(upperRaw, 'eth', MY_WALLET);
    expect(e.direction).toBe('in');
  });

  test('null value defaults to 0', () => {
    const raw = { ...SAMPLE_INCOMING_USDC, value: null };
    const e = normalizeTransfer(raw, 'eth', MY_WALLET);
    expect(e.amount).toBe(0);
  });
});

describe('Indexer › Transaction classification', () => {
  test('single incoming = receive', () => {
    const events = [normalizeTransfer(SAMPLE_INCOMING_USDC, 'eth', MY_WALLET)];
    classifyTxGroup(events);
    expect(events[0].type).toBe('receive');
  });

  test('single outgoing = send', () => {
    const events = [normalizeTransfer(SAMPLE_OUTGOING_ETH, 'eth', MY_WALLET)];
    classifyTxGroup(events);
    expect(events[0].type).toBe('send');
  });

  test('1 in + 1 out in same tx = swap', () => {
    const events = [
      normalizeTransfer(SAMPLE_INCOMING_USDC, 'eth', MY_WALLET),
      normalizeTransfer(SAMPLE_OUTGOING_ETH, 'eth', MY_WALLET),
    ];
    classifyTxGroup(events);
    expect(events[0].type).toBe('swap');
    expect(events[1].type).toBe('swap');
  });

  test('self transfer only = self_transfer', () => {
    const events = [normalizeTransfer(SAMPLE_SELF_TRANSFER, 'eth', MY_WALLET)];
    classifyTxGroup(events);
    expect(events[0].type).toBe('self_transfer');
  });

  test('multiple outs (no ins) = send', () => {
    const raw2 = { ...SAMPLE_OUTGOING_ETH, hash: '0xabc123def456abc123def456abc123def456abc123def456abc123def456abcd', uniqueId: 'u2' };
    const events = [
      normalizeTransfer(SAMPLE_OUTGOING_ETH, 'eth', MY_WALLET),
      normalizeTransfer(raw2, 'eth', MY_WALLET),
    ];
    classifyTxGroup(events);
    expect(events[0].type).toBe('send');
    expect(events[1].type).toBe('send');
  });

  test('empty array does not throw', () => {
    classifyTxGroup([]);
    expect(true).toBe(true);  // didn't throw
  });
});

describe('Indexer › Invariants', () => {
  test('INVARIANT: self-transfers always have direction=self (never in/out)', () => {
    const raw = { ...SAMPLE_INCOMING_USDC, from: MY_WALLET, to: MY_WALLET };
    const e = normalizeTransfer(raw, 'eth', MY_WALLET);
    expect(e.direction).toBe('self');
  });

  test('INVARIANT: counterparty is empty for self-transfers', () => {
    const e = normalizeTransfer(SAMPLE_SELF_TRANSFER, 'eth', MY_WALLET);
    expect(e.counterparty.address).toBe('');
  });

  test('INVARIANT: wallet address always lowercase in stored event', () => {
    const e = normalizeTransfer(SAMPLE_INCOMING_USDC, 'eth', MY_WALLET.toUpperCase());
    expect(e.walletAddress).toBe(MY_WALLET);
  });

  test('INVARIANT: amount is always a number (never string/null)', () => {
    const e1 = normalizeTransfer(SAMPLE_INCOMING_USDC, 'eth', MY_WALLET);
    expect(typeof e1.amount).toBe('number');

    const rawNull = { ...SAMPLE_INCOMING_USDC, value: null };
    const e2 = normalizeTransfer(rawNull, 'eth', MY_WALLET);
    expect(typeof e2.amount).toBe('number');

    const rawString = { ...SAMPLE_INCOMING_USDC, value: '1234.56' };
    const e3 = normalizeTransfer(rawString, 'eth', MY_WALLET);
    expect(e3.amount).toBe(1234.56);
  });
});
