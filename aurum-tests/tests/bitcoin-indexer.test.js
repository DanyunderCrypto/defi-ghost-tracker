// Tests for Bitcoin Indexer (Sprint 6)
// Validates xpub/address detection + Mempool tx normalization
const { describe, test, expect } = require('./_runner');

// Mirror of isXpub / isBtcAddress from HTML
function isXpub(input) {
  if (!input || typeof input !== 'string') return false;
  const s = input.trim();
  return /^(xpub|ypub|zpub|Xpub|Ypub|Zpub)[1-9A-HJ-NP-Za-km-z]{100,120}$/.test(s);
}

function isBtcAddress(input) {
  if (!input || typeof input !== 'string') return false;
  const s = input.trim();
  // Bech32 charset (excludes ambiguous chars b, i, o, 1)
  return /^(bc1[qpzry9x8gf2tvdw0s3jn54khce6mua7l]{25,89}|[13][a-km-zA-HJ-NP-Z1-9]{25,34})$/.test(s);
}

// Mirror of _normalizeTx from HTML
function normalizeTx(tx, ownedAddrs) {
  const ownedSet = new Set(ownedAddrs.map(a => a.toLowerCase()));
  const isOwned = (addr) => addr && ownedSet.has(addr.toLowerCase());

  let outFromOwned = 0;
  let inputAddrs = new Set();
  for (const vin of (tx.vin || [])) {
    const prevout = vin.prevout;
    if (!prevout) continue;
    const addr = prevout.scriptpubkey_address || '';
    inputAddrs.add(addr);
    if (isOwned(addr)) {
      outFromOwned += (prevout.value || 0);
    }
  }

  let inToOwned = 0;
  let externalOutputAddr = null;
  let externalOutputValue = 0;
  for (const vout of (tx.vout || [])) {
    const addr = vout.scriptpubkey_address || '';
    if (isOwned(addr)) {
      inToOwned += (vout.value || 0);
    } else if (vout.value > externalOutputValue) {
      externalOutputAddr = addr;
      externalOutputValue = vout.value;
    }
  }

  const netSats = inToOwned - outFromOwned;
  const isSelfTransfer = outFromOwned > 0 && inToOwned > 0 && externalOutputValue === 0;

  let direction, amountSats, counterpartyAddr;
  if (isSelfTransfer) {
    direction = 'self';
    amountSats = outFromOwned;
    counterpartyAddr = '';
  } else if (netSats < 0) {
    direction = 'out';
    amountSats = externalOutputValue || Math.abs(netSats);
    counterpartyAddr = externalOutputAddr || '';
  } else if (netSats > 0) {
    direction = 'in';
    amountSats = inToOwned;
    counterpartyAddr = [...inputAddrs].find(a => !isOwned(a)) || '';
  } else {
    direction = 'unknown';
    amountSats = 0;
    counterpartyAddr = '';
  }

  return {
    chain: 'bitcoin',
    txHash: tx.txid,
    direction,
    amount: amountSats / 1e8,
    asset: 'BTC',
    counterparty: { address: counterpartyAddr },
    type: direction === 'self' ? 'self_transfer' :
          direction === 'in'   ? 'receive' :
          direction === 'out'  ? 'send' : 'unknown',
  };
}

// ─────────────────────────────────────────────────
// xpub / address validation
// ─────────────────────────────────────────────────
describe('Bitcoin > xpub detection', () => {
  test('valid BIP44 xpub recognized', () => {
    const xpub = 'xpub6CUGRUonZSQ4TWtTMmzXdrXDtypWKiKrhko4egpiMZbpiaQL2jkwSB1icqYh2cfDfVxdx4df189oLKnC5fSwqPfgyP3hooxujYzAu3fDVmz';
    expect(isXpub(xpub)).toBe(true);
  });

  test('valid BIP49 ypub recognized', () => {
    const ypub = 'ypub6Ww3ibxVfGzLrAH1PNcjyAWenMTbbAosGNB6VvmSEgytSER9azLDWCxoJwW7Ke7icmizBMXrzBx9979FfaHxHcrArf3zbeJJJUZPf663zsP';
    expect(isXpub(ypub)).toBe(true);
  });

  test('valid BIP84 zpub recognized', () => {
    const zpub = 'zpub6jftahH18ngZxLmXaKw3GSZzZsszmt9WqedkyZdezFtWRFBZqsQH5hyUmb4pCEeZGmVfQuP5bedXTB8is6fTv19U1GQRyQUKQGUTzyHACMF';
    expect(isXpub(zpub)).toBe(true);
  });

  test('invalid xpub rejected', () => {
    expect(isXpub('xpub')).toBe(false);
    expect(isXpub('not_an_xpub')).toBe(false);
    expect(isXpub('')).toBe(false);
    expect(isXpub(null)).toBe(false);
  });

  test('EVM address is NOT xpub', () => {
    expect(isXpub('0xc3673ADCa09356F1B91A003D64D1cfe1f5431d7C')).toBe(false);
  });
});

describe('Bitcoin > address detection', () => {
  test('Bech32 P2WPKH address recognized', () => {
    expect(isBtcAddress('bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq')).toBe(true);
  });

  test('Bech32m P2TR (Taproot) address recognized', () => {
    expect(isBtcAddress('bc1p5d7rjq7g6rdk2yhzks9smlaqtedr4dekq08ge8ztwac72sfr9rusxg3297')).toBe(true);
  });

  test('Legacy P2PKH address recognized', () => {
    expect(isBtcAddress('1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa')).toBe(true);
  });

  test('P2SH address recognized', () => {
    expect(isBtcAddress('3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy')).toBe(true);
  });

  test('xpub is NOT a BTC address', () => {
    const xpub = 'xpub6CUGRUonZSQ4TWtTMmzXdrXDtypWKiKrhko4egpiMZbpiaQL2jkwSB1icqYh2cfDfVxdx4df189oLKnC5fSwqPfgyP3hooxujYzAu3fDVmz';
    expect(isBtcAddress(xpub)).toBe(false);
  });

  test('EVM address is NOT a BTC address', () => {
    expect(isBtcAddress('0xc3673ADCa09356F1B91A003D64D1cfe1f5431d7C')).toBe(false);
  });

  test('empty/null input rejected', () => {
    expect(isBtcAddress('')).toBe(false);
    expect(isBtcAddress(null)).toBe(false);
    expect(isBtcAddress(undefined)).toBe(false);
  });
});

// ─────────────────────────────────────────────────
// Transaction normalization
// ─────────────────────────────────────────────────
const MY_ADDR = 'bc1qmyownaddress00000000000000000000mywallet';
const EXTERNAL_ADDR = 'bc1qexternaladdressfromoutside000000external';
const ANOTHER_OWNED = 'bc1qanotherownedchangeaddress0000000000changeaddr';

describe('Bitcoin > Tx normalization: RECEIVE', () => {
  test('incoming tx from external = receive', () => {
    const tx = {
      txid: 'abc123',
      vin: [
        { prevout: { scriptpubkey_address: EXTERNAL_ADDR, value: 100000000 } }
      ],
      vout: [
        { scriptpubkey_address: MY_ADDR, value: 50000000 },
        { scriptpubkey_address: EXTERNAL_ADDR, value: 49990000 }, // change to sender
      ],
      status: { block_time: 1700000000, confirmed: true },
    };
    const evt = normalizeTx(tx, [MY_ADDR]);
    expect(evt.direction).toBe('in');
    expect(evt.amount).toBe(0.5); // 0.5 BTC
    expect(evt.counterparty.address).toBe(EXTERNAL_ADDR);
    expect(evt.type).toBe('receive');
  });
});

describe('Bitcoin > Tx normalization: SEND', () => {
  test('outgoing tx to external = send', () => {
    const tx = {
      txid: 'def456',
      vin: [
        { prevout: { scriptpubkey_address: MY_ADDR, value: 100000000 } }
      ],
      vout: [
        { scriptpubkey_address: EXTERNAL_ADDR, value: 60000000 },
        { scriptpubkey_address: MY_ADDR, value: 39990000 }, // change to us
      ],
      status: { block_time: 1700000000, confirmed: true },
    };
    const evt = normalizeTx(tx, [MY_ADDR]);
    expect(evt.direction).toBe('out');
    expect(evt.amount).toBe(0.6); // sent to external
    expect(evt.counterparty.address).toBe(EXTERNAL_ADDR);
    expect(evt.type).toBe('send');
  });
});

describe('Bitcoin > Tx normalization: SELF-TRANSFER (consolidation)', () => {
  test('all outputs to owned addresses = self_transfer', () => {
    // Classic consolidation: from one of my addrs to another of my addrs
    const tx = {
      txid: 'self123',
      vin: [
        { prevout: { scriptpubkey_address: MY_ADDR, value: 100000000 } }
      ],
      vout: [
        { scriptpubkey_address: ANOTHER_OWNED, value: 99990000 },
      ],
      status: { block_time: 1700000000, confirmed: true },
    };
    const evt = normalizeTx(tx, [MY_ADDR, ANOTHER_OWNED]);
    expect(evt.direction).toBe('self');
    expect(evt.type).toBe('self_transfer');
    expect(evt.counterparty.address).toBe('');
  });
});

describe('Bitcoin > Tax-critical invariants', () => {
  test('INVARIANT: self-transfers are NEVER classified as send/receive', () => {
    // Critical: consolidation between own addresses should NOT trigger taxable events
    const tx = {
      txid: 'consolidation_test',
      vin: [
        { prevout: { scriptpubkey_address: MY_ADDR, value: 50000000 } },
        { prevout: { scriptpubkey_address: ANOTHER_OWNED, value: 50000000 } }
      ],
      vout: [
        { scriptpubkey_address: ANOTHER_OWNED, value: 99990000 },
      ],
      status: { block_time: 1700000000, confirmed: true },
    };
    const evt = normalizeTx(tx, [MY_ADDR, ANOTHER_OWNED]);
    expect(evt.type === 'send').toBe(false);
    expect(evt.type === 'receive').toBe(false);
    expect(evt.type).toBe('self_transfer');
  });

  test('INVARIANT: send amount = value going to external (NOT net loss)', () => {
    // Why: net loss includes fees, but disposal amount for tax is what went TO counterparty
    const tx = {
      txid: 'send_with_fees',
      vin: [{ prevout: { scriptpubkey_address: MY_ADDR, value: 200000000 } }],
      vout: [
        { scriptpubkey_address: EXTERNAL_ADDR, value: 100000000 }, // disposal = 1 BTC
        { scriptpubkey_address: MY_ADDR, value: 99000000 },         // change
        // fee = 1000000 (1M sats)
      ],
      status: { block_time: 1700000000, confirmed: true },
    };
    const evt = normalizeTx(tx, [MY_ADDR]);
    expect(evt.direction).toBe('out');
    // Disposal amount must be the 1 BTC sent, NOT the 1.01 BTC net loss
    expect(evt.amount).toBe(1.0);
    expect(evt.counterparty.address).toBe(EXTERNAL_ADDR);
  });

  test('INVARIANT: receive amount = value coming TO us (not gross from sender)', () => {
    const tx = {
      txid: 'recv_test',
      vin: [{ prevout: { scriptpubkey_address: EXTERNAL_ADDR, value: 500000000 } }],
      vout: [
        { scriptpubkey_address: MY_ADDR, value: 100000000 },        // received = 1 BTC
        { scriptpubkey_address: EXTERNAL_ADDR, value: 399990000 },  // change back to sender
      ],
      status: { block_time: 1700000000, confirmed: true },
    };
    const evt = normalizeTx(tx, [MY_ADDR]);
    expect(evt.direction).toBe('in');
    expect(evt.amount).toBe(1.0);
  });

  test('INVARIANT: missing block_time gracefully handled (mempool tx)', () => {
    const tx = {
      txid: 'mempool_tx',
      vin: [{ prevout: { scriptpubkey_address: EXTERNAL_ADDR, value: 100000000 } }],
      vout: [{ scriptpubkey_address: MY_ADDR, value: 100000000 }],
      status: { confirmed: false },
    };
    const evt = normalizeTx(tx, [MY_ADDR]);
    expect(evt.direction).toBe('in');
    // Should not crash even without block_time
    expect(evt.amount).toBe(1.0);
  });

  test('INVARIANT: multi-recipient OUT identifies highest external output', () => {
    const tx = {
      txid: 'multi_recv',
      vin: [{ prevout: { scriptpubkey_address: MY_ADDR, value: 500000000 } }],
      vout: [
        { scriptpubkey_address: EXTERNAL_ADDR, value: 300000000 },       // primary recipient (3 BTC)
        { scriptpubkey_address: 'bc1qsomeotheraddrsmallpayment000other', value: 100000000 }, // small payment
        { scriptpubkey_address: MY_ADDR, value: 99000000 },              // change
      ],
      status: { block_time: 1700000000, confirmed: true },
    };
    const evt = normalizeTx(tx, [MY_ADDR]);
    expect(evt.direction).toBe('out');
    // Amount should be the LARGEST external output (heuristic for main counterparty)
    expect(evt.amount).toBe(3.0);
    expect(evt.counterparty.address).toBe(EXTERNAL_ADDR);
  });
});


describe('Bitcoin > address validation edge cases', () => {
  test('bech32 address with chars OUTSIDE valid charset is rejected', () => {
    // 'b', 'i', 'o', '1' are NOT in bech32 charset (data part)
    // This is what made `bc1qqg4n248lhdkfqcxelf7aqume2w7ljfjl4rv57` look valid but failed checksum
    // Specifically the 'b' in 'qg4n248' is invalid in bech32
    const fakeAddr = 'bc1qbbbbiiiioooo' + '1'.repeat(28);  // contains b/i/o/1 — invalid
    // Note: this won't trigger the regex check because 'b' is rejected; verify:
    const result = isBtcAddress(fakeAddr);
    expect(result).toBe(false);
  });

  test('real bech32 address from BIP173 spec example is accepted', () => {
    // Reference: BIP173 spec sample valid mainnet address
    const valid = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';
    expect(isBtcAddress(valid)).toBe(true);
  });

  test('Taproot (P2TR / bech32m) address is accepted', () => {
    const taproot = 'bc1p5d7rjq7g6rdk2yhzks9smlaqtedr4dekq08ge8ztwac72sfr9rusxg3297';
    expect(isBtcAddress(taproot)).toBe(true);
  });

  test('lowercase mixed with uppercase is rejected (bech32 must be single case)', () => {
    // Bech32 spec: addresses must be ALL lowercase OR ALL uppercase, not mixed
    // Our regex only allows lowercase
    const mixed = 'bc1QW508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';
    expect(isBtcAddress(mixed)).toBe(false);
  });
});
