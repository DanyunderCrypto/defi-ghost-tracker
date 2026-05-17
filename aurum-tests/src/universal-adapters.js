// AUTO-GENERATED FROM defi-ghost-tracker-v2.html — DO NOT EDIT DIRECTLY
// To resync: python3 scripts/sync-from-html.py
// Edit the HTML, then resync.

// UNIVERSAL CARD IMPORT — Adapter pattern
//
// Each issuer adapter must provide:
//   - name: display name
//   - detectFromHeaders(headers): boolean (strongest signal)
//   - detectFromFilename(filename): boolean (fallback)
//   - parseRow(row, headers): UniversalRow | null
//
// UniversalRow shape:
//   {
//     date: 'YYYY-MM-DD',
//     time: 'HH:MM:SS' (optional),
//     type: 'expense'|'topup'|'cashback'|'vault_in'|'vault_out'|'bridge'|'swap'|'withdrawal'|'declined'|'unknown',
//     status: 'CLEARED'|'PENDING'|'DECLINED',
//     merchant: string,
//     merchantCategory: string (optional),
//     chargedAmount: number,
//     chargedCurrency: string,
//     accountAmount: number (optional),
//     accountCurrency: string (optional),
//     inlineCashback: number (optional),
//     inlineCashbackCurrency: string (optional),
//     fundingAsset: string (optional),
//     fundingNetwork: string (optional),
//     txhash: string (optional),
//     _raw: original row
//   }
// ═══════════════════════════════════════════════════════════

// Helpers shared across adapters
function _parseDateFlexible(val) {
  if (!val) return { date: '', time: '' };
  if (val instanceof Date) {
    return { date: val.toISOString().slice(0, 10), time: val.toISOString().slice(11, 19) };
  }
  if (typeof val === 'number') {
    // Excel serial date
    const d = new Date((val - 25569) * 86400 * 1000);
    if (!isNaN(d.getTime())) return { date: d.toISOString().slice(0, 10), time: d.toISOString().slice(11, 19) };
  }
  const s = String(val).trim();

  // Try ISO-like: "2026-05-14 17:36:56 UTC" or "2026-05-14T17:36:56Z"
  const d1 = new Date(s);
  if (!isNaN(d1.getTime())) {
    return { date: d1.toISOString().slice(0, 10), time: d1.toISOString().slice(11, 19) };
  }

  // Try Tria format: "8:07 PM | 05/07/2026"
  const triaMatch = s.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)\s*\|\s*(\d{1,2})\/(\d{1,2})\/(\d{4})$/i);
  if (triaMatch) {
    let [, hh, mm, ampm, mo, da, yr] = triaMatch;
    hh = parseInt(hh);
    if (ampm.toUpperCase() === 'PM' && hh < 12) hh += 12;
    if (ampm.toUpperCase() === 'AM' && hh === 12) hh = 0;
    const iso = `${yr}-${mo.padStart(2,'0')}-${da.padStart(2,'0')}T${String(hh).padStart(2,'0')}:${mm}:00Z`;
    const d2 = new Date(iso);
    if (!isNaN(d2.getTime())) return { date: iso.slice(0, 10), time: iso.slice(11, 19) };
  }

  // Try US format: MM/DD/YYYY
  const usMatch = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (usMatch) {
    const [, mo, da, yr] = usMatch;
    return { date: `${yr}-${mo.padStart(2,'0')}-${da.padStart(2,'0')}`, time: '' };
  }

  // Try ISO date only: YYYY-MM-DD
  const isoMatch = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) return { date: isoMatch[0], time: '' };

  return { date: '', time: '' };
}

// Parse "EUR 15.99" or "$0.28" or "USD 36.89" etc.
function _parseAmountWithCurrency(val) {
  if (val == null || val === '') return { amount: 0, currency: '' };
  if (typeof val === 'number') return { amount: Math.abs(val), currency: '' };
  const s = String(val).trim();

  // "$0.28" or "€10.00"
  let m = s.match(/^([$€£])\s*(-?[\d.,]+)$/);
  if (m) {
    const sym = m[1];
    const amt = parseFloat(m[2].replace(/,/g, ''));
    const ccyMap = { '$': 'USD', '€': 'EUR', '£': 'GBP' };
    return { amount: Math.abs(amt), currency: ccyMap[sym] || '' };
  }

  // "EUR 15.99" or "USD 36.89"
  m = s.match(/^([A-Z]{3})\s+(-?[\d.,]+)$/);
  if (m) {
    return { amount: Math.abs(parseFloat(m[2].replace(/,/g, ''))), currency: m[1] };
  }

  // "15.99 EUR"
  m = s.match(/^(-?[\d.,]+)\s+([A-Z]{3})$/);
  if (m) {
    return { amount: Math.abs(parseFloat(m[1].replace(/,/g, ''))), currency: m[2] };
  }

  // Plain number
  const num = parseFloat(s.replace(/,/g, ''));
  if (!isNaN(num)) return { amount: Math.abs(num), currency: '' };

  return { amount: 0, currency: '' };
}

// Lookup column by aliases (case-insensitive)
function _col(row, ...names) {
  // Build lowercase key map once
  if (!row.__lc) {
    Object.defineProperty(row, '__lc', { value: {}, enumerable: false });
    for (const k in row) row.__lc[String(k).toLowerCase().trim()] = row[k];
  }
  for (const n of names) {
    const v = row.__lc[n.toLowerCase()];
    if (v !== undefined && v !== '') return v;
  }
  return '';
}

// ═══════════════════════════════════════════════════════════
// ADAPTERS
// ═══════════════════════════════════════════════════════════

const ETHERFI_ADAPTER = {
  name: 'ether.fi',
  detectFromHeaders(h) {
    const s = (h || []).map(x => String(x || '').toLowerCase()).join('|');
    return s.includes('spending mode') || (s.includes('original currency') && s.includes('cashback earned'));
  },
  detectFromFilename(fn) {
    const f = String(fn || '').toLowerCase();
    return f.includes('etherfi') || f.includes('ether.fi') || f.includes('transaction-history');
  },
  parseRow(row) {
    const { date, time } = _parseDateFlexible(_col(row, 'timestamp'));
    if (!date) return null;

    const txType = String(_col(row, 'type') || '').toLowerCase();
    const status = String(_col(row, 'status') || '').toUpperCase() || 'CLEARED';

    // Map ether.fi type to universal type
    const TYPE_MAP = {
      'card_spend': 'expense',
      'topup': 'topup',
      'liquid_deposit': 'vault_in',
      'liquid_execute_withdrawal': 'vault_out',
      'completed_withdrawal': 'withdrawal',
      'stargate_execute_bridge': 'bridge',
      'swap': 'swap',
      'referral_cashback': 'cashback',
    };
    const universalType = TYPE_MAP[txType] || 'unknown';

    const inlineCb = parseFloat(_col(row, 'cashback earned') || 0) || 0;

    return {
      date, time,
      type: universalType,
      status,
      merchant: String(_col(row, 'description') || '').trim(),
      merchantCategory: String(_col(row, 'category') || '').trim(),
      chargedAmount: parseFloat(_col(row, 'original amount') || _col(row, 'amount') || 0) || 0,
      chargedCurrency: String(_col(row, 'original currency') || _col(row, 'currency') || '').toUpperCase(),
      accountAmount: parseFloat(_col(row, 'amount') || 0) || 0,
      accountCurrency: String(_col(row, 'currency') || 'USD').toUpperCase(),
      inlineCashback: inlineCb,
      inlineCashbackCurrency: String(_col(row, 'cashback currency') || '').toUpperCase(),
      _raw: row,
    };
  },
};

const TRIA_ADAPTER = {
  name: 'Tria',
  detectFromHeaders(h) {
    const s = (h || []).map(x => String(x || '').toLowerCase()).join('|');
    return s.includes('time') && s.includes('description') && s.includes('spent') &&
           s.includes('cashback') && s.includes('transaction (usd)');
  },
  detectFromFilename(fn) {
    const f = String(fn || '').toLowerCase();
    return f.includes('tria') || f.includes('account-statement');
  },
  parseRow(row) {
    const timeVal = _col(row, 'Time');
    const { date, time } = _parseDateFlexible(timeVal);
    if (!date) return null;

    const description = String(_col(row, 'Description') || '').trim();
    const triaType = String(_col(row, 'Type') || '').toLowerCase();
    const spent = _col(row, 'Spent');     // "EUR 15.99" or "" for topups
    const cashback = _col(row, 'Cashback'); // "$0.28" or ""
    const txnUsd = _col(row, 'Transaction (USD)'); // "$19.06"

    // Determine universal type
    let universalType = 'unknown';
    if (triaType === 'credit' && /top\s*up/i.test(description)) {
      universalType = 'topup';
    } else if (triaType === 'debit') {
      universalType = 'expense';
    } else if (triaType === 'credit') {
      universalType = 'topup';  // any other credit
    }

    // Parse amounts
    const spentParsed = _parseAmountWithCurrency(spent);
    const cbParsed = _parseAmountWithCurrency(cashback);
    const txnParsed = _parseAmountWithCurrency(txnUsd);

    return {
      date, time,
      type: universalType,
      status: 'CLEARED',  // Tria has no status column → assume cleared
      merchant: description,
      merchantCategory: '',
      // For expenses: use spent (merchant amount)
      // For topups: use Transaction (USD)
      chargedAmount: universalType === 'expense' ? (spentParsed.amount || txnParsed.amount) : txnParsed.amount,
      chargedCurrency: universalType === 'expense' ? (spentParsed.currency || 'USD') : (txnParsed.currency || 'USD'),
      accountAmount: txnParsed.amount,
      accountCurrency: txnParsed.currency || 'USD',
      inlineCashback: cbParsed.amount,
      inlineCashbackCurrency: cbParsed.currency || 'USD',
      _raw: row,
    };
  },
};

const METAMASK_ADAPTER = {
  name: 'MetaMask',
  detectFromHeaders(h) {
    const s = (h || []).map(x => String(x || '').toLowerCase()).join('|');
    return s.includes('funding tokens') || s.includes('funding addresses') ||
           (s.includes('merchant type') && s.includes('transaction currency'));
  },
  detectFromFilename(fn) {
    const f = String(fn || '').toLowerCase();
    return f.includes('metamask');
  },
  parseRow(row) {
    const { date, time } = _parseDateFlexible(_col(row, 'Timestamp'));
    if (!date) return null;

    const merchant = String(_col(row, 'Merchant') || '').trim();
    const merchantType = String(_col(row, 'Merchant Type') || '').trim();

    // Extract cashback from "Funding Tokens" field
    // Examples:
    //   "13.65 usdc (linea) & 0.13 reward (null)"       ← has cashback
    //   "14.11 usdc (linea)"                            ← no cashback
    //   "46.59 usdc (linea) & 0.03 usdc (credit)"       ← credit, not cashback
    const fundingTokens = String(_col(row, 'Funding Tokens') || '').trim();
    let inlineCashback = 0;
    let fundingAsset = 'USDC';
    let fundingNetwork = 'linea';

    // Parse first token (the actual spend funding)
    const firstTokenMatch = fundingTokens.match(/^([\d.]+)\s+(\w+)\s*\(([^)]+)\)/);
    if (firstTokenMatch) {
      fundingAsset = firstTokenMatch[2].toUpperCase();
      fundingNetwork = firstTokenMatch[3].toLowerCase();
    }

    // Look for cashback "reward"
    const rewardMatch = fundingTokens.match(/&\s+([\d.]+)\s+reward/i);
    if (rewardMatch) inlineCashback = parseFloat(rewardMatch[1]) || 0;

    return {
      date, time,
      type: 'expense',  // MetaMask export only has spends (no topups, no cashbacks separate)
      status: 'CLEARED',
      merchant,
      merchantCategory: merchantType, // "InWalletPOS", "Online", etc. — not MCC but useful
      chargedAmount: parseFloat(_col(row, 'Transaction currency amount') || 0) || 0,
      chargedCurrency: String(_col(row, 'Transaction Currency') || 'EUR').toUpperCase(),
      accountAmount: parseFloat(_col(row, 'Card currency amount') || 0) || 0,
      accountCurrency: String(_col(row, 'Card currency') || 'USD').toUpperCase(),
      inlineCashback,
      inlineCashbackCurrency: fundingAsset,  // cashback is in USDC (or whatever the funding asset is)
      fundingAsset,
      fundingNetwork,
      _raw: row,
    };
  },
};

// Generic fallback (tries common keywords)
const GENERIC_ADAPTER = {
  name: 'Outro',
  detectFromHeaders(h) { return false; },
  detectFromFilename(fn) { return false; },
  parseRow(row) {
    const dateVal = _col(row, 'date', 'timestamp', 'time', 'data', 'datetime');
    const { date, time } = _parseDateFlexible(dateVal);
    if (!date) return null;

    return {
      date, time,
      type: 'expense',  // assume expense
      status: 'CLEARED',
      merchant: String(_col(row, 'merchant', 'description', 'memo', 'note', 'descricao') || '').trim(),
      merchantCategory: String(_col(row, 'category', 'merchant category', 'categoria') || '').trim(),
      chargedAmount: parseFloat(_col(row, 'amount', 'value', 'total', 'valor') || 0) || 0,
      chargedCurrency: String(_col(row, 'currency', 'moeda') || 'EUR').toUpperCase(),
      accountAmount: 0,
      accountCurrency: '',
      inlineCashback: parseFloat(_col(row, 'cashback', 'cashback earned', 'reward') || 0) || 0,
      inlineCashbackCurrency: 'EUR',
      _raw: row,
    };
  },
};

const UNIVERSAL_ADAPTERS = {
  etherfi:  ETHERFI_ADAPTER,
  tria:     TRIA_ADAPTER,
  metamask: METAMASK_ADAPTER,
  outro:    GENERIC_ADAPTER,
};

// Auto-detect issuer using BOTH headers and filename
function detectIssuerUniversal(filename, headers) {
  for (const [id, adapter] of Object.entries(UNIVERSAL_ADAPTERS)) {
    if (id === 'outro') continue;  // skip generic in detection
    if (adapter.detectFromHeaders(headers)) return id;
  }
  for (const [id, adapter] of Object.entries(UNIVERSAL_ADAPTERS)) {
    if (id === 'outro') continue;
    if (adapter.detectFromFilename(filename)) return id;
  }
  return null;
}

// Parse all rows using the issuer's adapter
function parseRowsUniversal(rows, issuerId) {
  const adapter = UNIVERSAL_ADAPTERS[issuerId] || GENERIC_ADAPTER;
  const out = [];
  const skipped = [];
  rows.forEach((row, idx) => {
    try {
      const parsed = adapter.parseRow(row);
      if (parsed) {
        out.push(parsed);
      } else {
        skipped.push({ idx, row, reason: 'parseRow returned null (likely no valid date)' });
      }
    } catch (err) {
      skipped.push({ idx, row, reason: 'parse error: ' + err.message });
    }
  });
  return { parsed: out, skipped };
}

// Expose
module.exports.UNIVERSAL_ADAPTERS = UNIVERSAL_ADAPTERS;
module.exports.detectIssuerUniversal = detectIssuerUniversal;
module.exports.parseRowsUniversal = parseRowsUniversal;
module.exports._parseDateFlexible = _parseDateFlexible;
module.exports._parseAmountWithCurrency = _parseAmountWithCurrency;



// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  SECTION 4 — DOMAIN: CLASSIFIER (pure, testable)                        ║
// ║  Tax categorization per the Lei 24-D/2022 / Art. 10º CIRS               ║
// ║  Synced to: aurum-tests/src/classifier.js                               ║
// ║  Test invariants documented in tests/integration.test.js                ║
// ╚══════════════════════════════════════════════════════════════════════════╝
