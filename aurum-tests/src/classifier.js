// AUTO-GENERATED FROM defi-ghost-tracker-v2.html — DO NOT EDIT DIRECTLY
// To resync: python3 scripts/sync-from-html.py
// Edit the HTML, then resync.

const { UNIVERSAL_ADAPTERS, detectIssuerUniversal, _parseDateFlexible, _parseAmountWithCurrency } = require('./universal-adapters');
const GENERIC_ADAPTER = UNIVERSAL_ADAPTERS.outro;

// FASE 6B: Transaction Classifier — multi-issuer ready
// ═══════════════════════════════════════════════════════════
//
// Categories (universal across all issuers):
//   'expense'      — card purchase that cleared (taxable depending on card funding)
//   'topup'        — deposit INTO the card balance (transfer, not expense)
//   'vault_in'     — deposit into a yield vault (crypto-to-crypto permuta)
//   'vault_out'    — withdrawal from a yield vault (crypto-to-crypto permuta)
//   'bridge'       — cross-chain bridge (same asset, different chain)
//   'swap'         — crypto-to-crypto swap (permuta, herda valor de aquisição)
//   'cashback'     — referral/rewards received in crypto (creates new lot)
//   'withdrawal'   — withdrawal from card back to external wallet
//   'declined'     — failed/declined transaction (ignored entirely)
//   'pending'      — needs user confirmation
//   'income'       — fiat income (interest, dividends — Categoria E)
//   'unknown'      — cannot classify; user must decide
//
// Action verbs:
//   'process'  — import and apply tax treatment
//   'ignore'   — skip entirely (won't appear anywhere)
//   'pending'  — show in inbox, requires user confirmation

const TX_CATEGORIES = {
  EXPENSE:    'expense',
  TOPUP:      'topup',
  VAULT_IN:   'vault_in',
  VAULT_OUT:  'vault_out',
  BRIDGE:     'bridge',
  SWAP:       'swap',
  CASHBACK:   'cashback',
  WITHDRAWAL: 'withdrawal',
  DECLINED:   'declined',
  PENDING:    'pending',
  INCOME:     'income',
  UNKNOWN:    'unknown',
};

// Universal status whitelist/blacklist
const TX_STATUS_OK   = new Set(['CLEARED','COMPLETED','CONFIRMED','APPROVED','SUCCESS','DONE','']);
const TX_STATUS_BAD  = new Set(['DECLINED','FAILED','REJECTED','CANCELLED','CANCELED','REVERSED','REVERTED','REFUNDED','ERROR']);
const TX_STATUS_WAIT = new Set(['PENDING','PROCESSING','AUTHORIZED','HOLD','SUBMITTED']);

// ─────────────────────────────────────────────────
// ISSUER ADAPTERS — each issuer has its own type→category map
// ─────────────────────────────────────────────────

const ETHERFI_TX_MAP = {
  // Verified types from ether.fi Excel export:
  'card_spend':                TX_CATEGORIES.EXPENSE,
  'topup':                     TX_CATEGORIES.TOPUP,
  'liquid_deposit':            TX_CATEGORIES.VAULT_IN,
  'liquid_execute_withdrawal': TX_CATEGORIES.VAULT_OUT,
  'completed_withdrawal':      TX_CATEGORIES.WITHDRAWAL,
  'stargate_execute_bridge':   TX_CATEGORIES.BRIDGE,
  'swap':                      TX_CATEGORIES.SWAP,
  'referral_cashback':         TX_CATEGORIES.CASHBACK,
  // Future types (added defensively):
  'cashback':                  TX_CATEGORIES.CASHBACK,
  'yield_distribution':        TX_CATEGORIES.CASHBACK,
  'interest_payment':          TX_CATEGORIES.INCOME,
  'deposit':                   TX_CATEGORIES.TOPUP,
  'withdrawal':                TX_CATEGORIES.WITHDRAWAL,
  'refund':                    TX_CATEGORIES.WITHDRAWAL,
};

// Other issuers (skeletons — to be filled when we get sample exports):
const METAMASK_TX_MAP = {
  'purchase':      TX_CATEGORIES.EXPENSE,
  'spend':         TX_CATEGORIES.EXPENSE,
  'topup':         TX_CATEGORIES.TOPUP,
  'load':          TX_CATEGORIES.TOPUP,
  'reward':        TX_CATEGORIES.CASHBACK,
  'cashback':      TX_CATEGORIES.CASHBACK,
  'swap':          TX_CATEGORIES.SWAP,
  'bridge':        TX_CATEGORIES.BRIDGE,
  'withdrawal':    TX_CATEGORIES.WITHDRAWAL,
};

const GNOSIS_TX_MAP = {
  'card_spend':    TX_CATEGORIES.EXPENSE,
  'card_payment':  TX_CATEGORIES.EXPENSE,
  'deposit':       TX_CATEGORIES.TOPUP,
  'topup':         TX_CATEGORIES.TOPUP,
  'withdrawal':    TX_CATEGORIES.WITHDRAWAL,
  'cashback':      TX_CATEGORIES.CASHBACK,
};

const KAST_TX_MAP = {
  'purchase':      TX_CATEGORIES.EXPENSE,
  'spend':         TX_CATEGORIES.EXPENSE,
  'topup':         TX_CATEGORIES.TOPUP,
  'cashback':      TX_CATEGORIES.CASHBACK,
};

const REDOTPAY_TX_MAP = {
  'purchase':      TX_CATEGORIES.EXPENSE,
  'spend':         TX_CATEGORIES.EXPENSE,
  'topup':         TX_CATEGORIES.TOPUP,
  'rebate':        TX_CATEGORIES.CASHBACK,
  'cashback':      TX_CATEGORIES.CASHBACK,
};

const TRIA_TX_MAP = {
  'payment':       TX_CATEGORIES.EXPENSE,
  'spend':         TX_CATEGORIES.EXPENSE,
  'topup':         TX_CATEGORIES.TOPUP,
  'reward':        TX_CATEGORIES.CASHBACK,
};

// All issuers map to the same canonical type set, because normalizeTxRow uses
// the universal adapter which translates every issuer's native types to ether.fi-style.
// (e.g. Tria 'Debit' → 'card_spend', MetaMask spend rows → 'card_spend', etc.)
const ISSUER_ADAPTERS = {
  'etherfi':  { map: ETHERFI_TX_MAP, name: 'ether.fi'   },
  'metamask': { map: ETHERFI_TX_MAP, name: 'MetaMask'   },
  'gnosis':   { map: ETHERFI_TX_MAP, name: 'Gnosis Pay' },
  'kast':     { map: ETHERFI_TX_MAP, name: 'Kast'       },
  'redotpay': { map: ETHERFI_TX_MAP, name: 'RedotPay'   },
  'tria':     { map: ETHERFI_TX_MAP, name: 'Tria'       },
  'outro':    { map: ETHERFI_TX_MAP, name: 'Outro'      },
};

// ─────────────────────────────────────────────────
// CORE CLASSIFIER — pure function
// ─────────────────────────────────────────────────
// Input:
//   tx = { type, status, description, amount, currency, originalAmount, originalCurrency, ... }
//   issuerId = 'etherfi' | 'metamask' | ... | null (auto-detect failed)
//   cardCtx = { defaultFundingSource, primaryAsset, linkedLoanProtocols } | null
//
// Output:
//   {
//     category: TX_CATEGORIES.*,
//     action: 'process' | 'ignore' | 'pending',
//     needsUserConfirm: boolean,
//     reason: string,
//     evidence: { typeMatched, statusMatched, ... },
//     taxTreatment: 'disposal' | 'loan_spend' | 'stable_pass' | 'permuta_no_event' | 'reward_new_lot' | 'transfer_internal' | 'ignored',
//   }

function classifyTransaction(tx, issuerId, cardCtx) {
  if (!tx) return { category: TX_CATEGORIES.UNKNOWN, action: 'ignore', reason: 'Empty tx' };

  const type = String(tx.type || '').toLowerCase().trim();
  const statusRaw = String(tx.status || '').toUpperCase().trim();
  const adapter = ISSUER_ADAPTERS[issuerId] || ISSUER_ADAPTERS.outro;

  // === 1. STATUS FILTER (universal) ===
  if (TX_STATUS_BAD.has(statusRaw)) {
    return {
      category: TX_CATEGORIES.DECLINED,
      action: 'ignore',
      needsUserConfirm: false,
      reason: `Status '${statusRaw}' — transação não concluída`,
      evidence: { statusMatched: statusRaw },
      taxTreatment: 'ignored',
    };
  }

  if (TX_STATUS_WAIT.has(statusRaw) && type === 'card_spend') {
    // Pending card spends: import as expense but flag for re-check
    // (we accept them because they typically clear within 24-48h)
  }

  // === 2. TYPE MAPPING (per-issuer) ===
  const category = adapter.map[type];

  if (!category) {
    return {
      category: TX_CATEGORIES.UNKNOWN,
      action: 'pending',
      needsUserConfirm: true,
      reason: `Tipo '${type}' não reconhecido para ${adapter.name}`,
      evidence: { typeMatched: null, statusMatched: statusRaw },
      taxTreatment: 'unknown',
    };
  }

  // === 3. TAX TREATMENT (based on category + card funding context) ===
  let taxTreatment = 'ignored';
  let action = 'process';
  let reason = '';

  switch (category) {
    case TX_CATEGORIES.EXPENSE:
      if (!cardCtx || cardCtx.defaultFundingSource === 'unknown') {
        action = 'pending';
        taxTreatment = 'unknown';
        reason = 'Aguarda setup fiscal do cartão para classificar';
      } else if (cardCtx.defaultFundingSource === 'loan') {
        taxTreatment = 'loan_spend';
        reason = 'Cartão financiado por empréstimo — gasto não constitui alienação fiscal';
      } else if (cardCtx.defaultFundingSource === 'own') {
        // Check if the spent asset is a stable pegged to fiat (EUR)
        const asset = String(tx.originalCurrency || tx.currency || '').toUpperCase();
        if (['EUR','EURE','EURC','PYUSD'].includes(asset)) {
          taxTreatment = 'stable_pass';
          reason = 'Pagamento em stable EUR — alienação técnica sem mais-valia significativa';
        } else {
          taxTreatment = 'disposal';
          reason = 'Pagamento com cripto próprio — alienação fiscal (Categoria G)';
        }
      } else {
        // mixed: needs per-topup classification
        action = 'pending';
        taxTreatment = 'unknown';
        reason = 'Cartão em modo misto — necessária confirmação por topup';
      }
      break;

    case TX_CATEGORIES.TOPUP:
      taxTreatment = 'transfer_internal';
      reason = 'Depósito no cartão — movimento entre wallets próprias';
      break;

    case TX_CATEGORIES.VAULT_IN:
    case TX_CATEGORIES.VAULT_OUT:
      taxTreatment = 'permuta_no_event';
      reason = 'Permuta cripto-cripto (vault) — não tributável (art. 10º nº 6 CIRS)';
      break;

    case TX_CATEGORIES.BRIDGE:
      taxTreatment = 'transfer_internal';
      reason = 'Bridge inter-chain — mesmo ativo, sem evento fiscal';
      break;

    case TX_CATEGORIES.SWAP:
      taxTreatment = 'permuta_no_event';
      reason = 'Swap cripto-cripto — não tributável; novo activo herda valor de aquisição';
      break;

    case TX_CATEGORIES.CASHBACK:
      taxTreatment = 'reward_new_lot';
      reason = 'Cashback/rewards — cria lote 365d com basis = valor EUR à data do recebimento';
      break;

    case TX_CATEGORIES.WITHDRAWAL:
      taxTreatment = 'transfer_internal';
      reason = 'Saída do cartão para wallet externa — sem evento fiscal';
      break;

    case TX_CATEGORIES.INCOME:
      taxTreatment = 'disposal';  // (placeholder — Categoria E for fiat income)
      reason = 'Rendimento de capitais (Categoria E)';
      break;

    default:
      action = 'ignore';
      taxTreatment = 'ignored';
      reason = 'Categoria sem tratamento fiscal';
  }

  return {
    category,
    action,
    needsUserConfirm: action === 'pending',
    reason,
    evidence: { typeMatched: type, statusMatched: statusRaw, issuer: issuerId },
    taxTreatment,
  };
}

// ─────────────────────────────────────────────────
// BATCH CLASSIFIER — classifies all rows + returns summary
// ─────────────────────────────────────────────────
function classifyTransactionBatch(rows, issuerId, cardCtx) {
  const result = {
    total: rows.length,
    byCategory: {},
    byAction: { process: 0, ignore: 0, pending: 0 },
    byTreatment: {},
    items: [],
    needsConfirm: [],
    skippedNullRows: 0,
  };

  rows.forEach((tx, idx) => {
    if (!tx) { result.skippedNullRows++; return; }  // adapter returned null

    const c = classifyTransaction(tx, issuerId, cardCtx);
    const item = { idx, tx, classification: c };
    result.items.push(item);

    result.byCategory[c.category] = (result.byCategory[c.category] || 0) + 1;
    result.byAction[c.action] = (result.byAction[c.action] || 0) + 1;
    result.byTreatment[c.taxTreatment] = (result.byTreatment[c.taxTreatment] || 0) + 1;

    if (c.needsUserConfirm) result.needsConfirm.push(item);
  });

  return result;
}

// Expose for console testing

// ─────────────────────────────────────────────────
// Auto-detect issuer from filename + headers
// ─────────────────────────────────────────────────
function detectIssuerFromImport(filename, headers) {
  // Use the universal adapter system (preferred — uses adapter.detectFromHeaders/Filename)
  return detectIssuerUniversal(filename, headers);
}

// ─────────────────────────────────────────────────
// Normalize a tx row from any issuer into our universal shape
// ─────────────────────────────────────────────────
function normalizeTxRow(row, issuerId) {
  // Universal adapter pipeline:
  //   1. Use the issuer's parseRow to get a UniversalRow
  //   2. Translate to the "legacy" shape that classifyTransaction expects
  //      (because the classifier was written against the old shape)
  const adapter = UNIVERSAL_ADAPTERS[issuerId] || GENERIC_ADAPTER;
  const u = adapter.parseRow(row);
  if (!u) return null;

  // Translate UniversalRow → classifier-compatible row
  // The classifier looks at: type, status, description, amount, currency, originalAmount, originalCurrency, category
  //
  // We map universal `type` (already mapped to 'expense'/'topup'/'cashback'/etc) BACK to ether.fi-style names
  // because the classifier maps native types → categories. The cleanest approach is to make the classifier accept
  // BOTH the universal type and the native one. To minimize change here, we synthesize a synthetic native type.
  const UNIVERSAL_TO_NATIVE = {
    'expense':    'card_spend',
    'topup':      'topup',
    'cashback':   'referral_cashback',
    'vault_in':   'liquid_deposit',
    'vault_out':  'liquid_execute_withdrawal',
    'bridge':     'stargate_execute_bridge',
    'swap':       'swap',
    'withdrawal': 'completed_withdrawal',
    'declined':   'card_spend',  // DECLINED status will be handled separately
    'unknown':    'unknown',
  };

  return {
    // Translation for classifier compatibility
    type:             UNIVERSAL_TO_NATIVE[u.type] || u.type,
    status:           u.status,
    description:      u.merchant,
    timestamp:        u.date + (u.time ? 'T' + u.time : ''),
    // Use ACCOUNT amount as the legacy "amount" (was always in card currency before)
    amount:           u.accountAmount || u.chargedAmount || 0,
    currency:         u.accountCurrency || u.chargedCurrency || 'USD',
    originalAmount:   u.chargedAmount || 0,
    originalCurrency: u.chargedCurrency || '',
    category:         u.merchantCategory || '',
    txhash:           u.txhash || '',
    inlineCashback:   u.inlineCashback || 0,
    inlineCashbackCurrency: u.inlineCashbackCurrency || '',
    // Pass-through extras
    fundingAsset:     u.fundingAsset || '',
    fundingNetwork:   u.fundingNetwork || '',
    _universal:       u,   // keep the universal version too
    _raw:             row,
  };
}

module.exports.detectIssuerFromImport = detectIssuerFromImport;
module.exports.normalizeTxRow = normalizeTxRow;

// ═══════════════════════════════════════════════════════════

// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  SECTION 5 — IMPORT FLOW: PREVIEW & CONFIRM                             ║
// ║  Tax-aware UI for confirming imports (DOM-dependent)                    ║
// ╚══════════════════════════════════════════════════════════════════════════╝

// Auto-added exports
module.exports.classifyTransaction = classifyTransaction;
module.exports.classifyTransactionBatch = classifyTransactionBatch;
module.exports.TX_CATEGORIES = TX_CATEGORIES;

