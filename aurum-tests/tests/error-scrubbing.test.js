// Tests for PII scrubbing logic (Sprint 3)
const { describe, test, expect } = require('./_runner');

// Mirror of SCRUB_PATTERNS from the HTML (kept in sync manually)
const SCRUB_PATTERNS = [
  // ORDER MATTERS — see HTML for rationale
  { pattern: /0x[a-fA-F0-9]{64}\b/g, replacement: '0x…[TXHASH]' },
  { pattern: /0x[a-fA-F0-9]{40}\b/g, replacement: '0x…[ADDR]' },
  { pattern: /\b(bc1[a-zA-HJ-NP-Z0-9]{25,89}|[13][a-km-zA-HJ-NP-Z1-9]{25,34})\b/g, replacement: '[BTC_ADDR]' },
  { pattern: /\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/g, replacement: '[SOL_ADDR]' },
  { pattern: /\b\d{10,}\b/g, replacement: '[NUM]' },
  { pattern: /\b[a-zA-Z0-9_-]{40,}\b/g, replacement: (m) => {
    return /[A-Z]/.test(m) && /[a-z]/.test(m) && /[0-9]/.test(m) ? '[KEY]' : m;
  }},
];

function scrubMessage(msg) {
  if (typeof msg !== 'string') {
    try { msg = String(msg); } catch (e) { return '[unstringifiable]'; }
  }
  let out = msg;
  for (const { pattern, replacement } of SCRUB_PATTERNS) {
    try { out = out.replace(pattern, replacement); } catch (e) {}
  }
  if (out.length > 1000) out = out.slice(0, 1000) + '…[truncated]';
  return out;
}

describe('PII scrubbing > EVM addresses', () => {
  test('full EVM address is scrubbed', () => {
    const out = scrubMessage('Error fetching 0xc3673ADCa09356F1B91A003D64D1cfe1f5431d7C balance');
    expect(out).toContain('0x…[ADDR]');
    expect(out).toBe('Error fetching 0x…[ADDR] balance');
  });

  test('multiple addresses scrubbed in same message', () => {
    const out = scrubMessage('Transfer from 0xc3673ADCa09356F1B91A003D64D1cfe1f5431d7C to 0xd9145CCE52D386f254917e481eB44e9943F39138');
    const matches = out.match(/\[ADDR\]/g);
    expect(matches.length).toBe(2);
  });

  test('short hex strings preserved', () => {
    const out = scrubMessage('chain id 0x1 base');
    expect(out).toContain('0x1');
  });
});

describe('PII scrubbing > Transaction hashes', () => {
  test('full 64-char txhash is scrubbed (and NOT split into addresses)', () => {
    const tx = '0x4f8e3a9c7b5d2f1e6a8b9c0d3e5f7a1b4c6d8e0f2a5b7c9d1e3f5a7b9c0d2e4f';
    const out = scrubMessage(`tx ${tx} failed`);
    expect(out).toContain('0x…[TXHASH]');
    // CRITICAL: must not have ADDR markers in there
    expect(out.includes('[ADDR]')).toBe(false);
  });

  test('txhash and address coexist correctly', () => {
    const out = scrubMessage('from 0xc3673ADCa09356F1B91A003D64D1cfe1f5431d7C in tx 0x4f8e3a9c7b5d2f1e6a8b9c0d3e5f7a1b4c6d8e0f2a5b7c9d1e3f5a7b9c0d2e4f');
    expect(out).toContain('[ADDR]');
    expect(out).toContain('[TXHASH]');
  });
});

describe('PII scrubbing > Long numbers', () => {
  test('large number (10+ digits) is scrubbed', () => {
    const out = scrubMessage('Balance: 1234567890123 wei');
    expect(out).toContain('[NUM]');
  });

  test('short numbers preserved', () => {
    const out = scrubMessage('HF 1.234 LTV 78%');
    expect(out).toBe('HF 1.234 LTV 78%');
  });

  test('7-digit block number preserved', () => {
    const out = scrubMessage('block 1000000');
    expect(out).toBe('block 1000000');
  });
});

describe('PII scrubbing > Bitcoin addresses', () => {
  test('Bech32 P2WPKH address scrubbed', () => {
    const out = scrubMessage('Send to bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq');
    expect(out).toContain('[BTC_ADDR]');
  });

  test('Legacy P2PKH address scrubbed (and NOT as Solana)', () => {
    const out = scrubMessage('Send to 1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa');
    expect(out).toContain('[BTC_ADDR]');
    expect(out.includes('[SOL_ADDR]')).toBe(false);
  });
});

describe('PII scrubbing > Edge cases', () => {
  test('null input returns empty-ish string', () => {
    const out = scrubMessage(null);
    expect(typeof out).toBe('string');
  });

  test('undefined input returns empty-ish string', () => {
    const out = scrubMessage(undefined);
    expect(typeof out).toBe('string');
  });

  test('very long message is truncated', () => {
    const long = 'x'.repeat(2000);
    const out = scrubMessage(long);
    expect(out.length).toBe(1000 + '…[truncated]'.length);
  });

  test('error message preserved for known errors', () => {
    const out = scrubMessage('Failed to fetch positions: timeout');
    expect(out).toBe('Failed to fetch positions: timeout');
  });
});

describe('PII scrubbing > Composite scenarios', () => {
  test('real-world error message gets fully scrubbed', () => {
    const realError = 'Failed fetching balance for 0xc3673ADCa09356F1B91A003D64D1cfe1f5431d7C: balance 12345678901234 wei (tx: 0x4f8e3a9c7b5d2f1e6a8b9c0d3e5f7a1b4c6d8e0f2a5b7c9d1e3f5a7b9c0d2e4f)';
    const out = scrubMessage(realError);
    expect(out).toContain('[ADDR]');
    expect(out).toContain('[NUM]');
    expect(out).toContain('[TXHASH]');
  });
});
