// Universal adapter tests — parsing real exports from 3 issuers
const { describe, test, expect } = require('./_runner');
const fs = require('fs');
const path = require('path');
const {
  UNIVERSAL_ADAPTERS,
  detectIssuerUniversal,
  parseRowsUniversal,
  _parseDateFlexible,
  _parseAmountWithCurrency,
} = require('../src/universal-adapters');
const { normalizeTxRow, detectIssuerFromImport } = require('../src/classifier');

function loadFixture(name) {
  return JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'fixtures', name), 'utf-8'));
}

describe('_parseDateFlexible › formats', () => {
  test('ISO datetime', () => {
    const r = _parseDateFlexible('2026-05-14T17:36:56Z');
    expect(r.date).toBe('2026-05-14');
    expect(r.time).toBe('17:36:56');
  });

  test('ether.fi format with UTC suffix', () => {
    const r = _parseDateFlexible('2026-05-14 17:36:56 UTC');
    expect(r.date).toBe('2026-05-14');
  });

  test('Tria format: "8:07 PM | 05/07/2026"', () => {
    const r = _parseDateFlexible('8:07 PM | 05/07/2026');
    expect(r.date).toBe('2026-05-07');
    expect(r.time).toBe('20:07:00');
  });

  test('Tria AM format', () => {
    const r = _parseDateFlexible('8:30 AM | 03/22/2026');
    expect(r.date).toBe('2026-03-22');
    expect(r.time).toBe('08:30:00');
  });

  test('Tria 12 PM (noon)', () => {
    const r = _parseDateFlexible('12:00 PM | 03/22/2026');
    expect(r.time).toBe('12:00:00');
  });

  test('Tria 12 AM (midnight)', () => {
    const r = _parseDateFlexible('12:30 AM | 03/22/2026');
    expect(r.time).toBe('00:30:00');
  });

  test('Date only (YYYY-MM-DD)', () => {
    const r = _parseDateFlexible('2025-12-22');
    expect(r.date).toBe('2025-12-22');
  });

  test('Invalid input returns empty', () => {
    const r = _parseDateFlexible('not a date');
    expect(r.date).toBe('');
  });

  test('Null/undefined safe', () => {
    expect(_parseDateFlexible(null).date).toBe('');
    expect(_parseDateFlexible(undefined).date).toBe('');
    expect(_parseDateFlexible('').date).toBe('');
  });
});

describe('_parseAmountWithCurrency › formats', () => {
  test('$0.28', () => {
    const r = _parseAmountWithCurrency('$0.28');
    expect(r.amount).toBe(0.28);
    expect(r.currency).toBe('USD');
  });

  test('€10.00', () => {
    const r = _parseAmountWithCurrency('€10.00');
    expect(r.currency).toBe('EUR');
    expect(r.amount).toBe(10);
  });

  test('EUR 15.99', () => {
    const r = _parseAmountWithCurrency('EUR 15.99');
    expect(r.amount).toBe(15.99);
    expect(r.currency).toBe('EUR');
  });

  test('USD 36.89', () => {
    const r = _parseAmountWithCurrency('USD 36.89');
    expect(r.currency).toBe('USD');
  });

  test('Plain number', () => {
    const r = _parseAmountWithCurrency(42.5);
    expect(r.amount).toBe(42.5);
  });

  test('Empty input', () => {
    expect(_parseAmountWithCurrency('').amount).toBe(0);
    expect(_parseAmountWithCurrency(null).amount).toBe(0);
  });
});

describe('Adapter › ether.fi', () => {
  const fx = loadFixture('etherfi.sample.json');

  test('detects from headers', () => {
    const detected = detectIssuerUniversal(fx.filename, fx.headers);
    expect(detected).toBe('etherfi');
  });

  test('detects from filename even without headers', () => {
    const detected = detectIssuerUniversal('transaction-history-2026-05-14.xlsx', []);
    expect(detected).toBe('etherfi');
  });

  test('parses all 13 rows without errors', () => {
    const result = parseRowsUniversal(fx.rows, 'etherfi');
    expect(result.parsed.length).toBe(13);
    expect(result.skipped.length).toBe(0);
  });

  test('first row matches expected structure', () => {
    const result = parseRowsUniversal(fx.rows, 'etherfi');
    const first = result.parsed[0];
    expect(first.date).toBe('2026-05-14');
    expect(first.type).toBe('expense');
    expect(first.status).toBe('PENDING');
    expect(first.merchant).toBe('CONTINENTE BOM DIA');
    expect(first.chargedAmount).toBe(2.42);
    expect(first.chargedCurrency).toBe('EUR');
    expect(first.inlineCashback).toBe(0.1);
  });

  test('all 13 rows have inline cashback', () => {
    const result = parseRowsUniversal(fx.rows, 'etherfi');
    const withCb = result.parsed.filter(p => p.inlineCashback > 0);
    expect(withCb.length).toBe(13);
  });

  test('integrates with normalizeTxRow + classifyTransaction', () => {
    const normalized = fx.rows.map(r => normalizeTxRow(r, 'etherfi')).filter(n => n !== null);
    expect(normalized.length).toBe(13);
  });
});

describe('Adapter › Tria', () => {
  const fx = loadFixture('tria.sample.json');

  test('detects from headers', () => {
    const detected = detectIssuerUniversal(fx.filename, fx.headers);
    expect(detected).toBe('tria');
  });

  test('parses all 73 rows', () => {
    const result = parseRowsUniversal(fx.rows, 'tria');
    expect(result.parsed.length).toBe(73);
    expect(result.skipped.length).toBe(0);
  });

  test('correctly identifies 50 expenses and 23 topups', () => {
    const result = parseRowsUniversal(fx.rows, 'tria');
    const expenses = result.parsed.filter(p => p.type === 'expense').length;
    const topups = result.parsed.filter(p => p.type === 'topup').length;
    expect(expenses).toBe(50);
    expect(topups).toBe(23);
  });

  test('inline cashback extracted from "Cashback" column', () => {
    const result = parseRowsUniversal(fx.rows, 'tria');
    const withCb = result.parsed.filter(p => p.inlineCashback > 0);
    expect(withCb.length).toBe(50);
  });

  test('topups have no cashback', () => {
    const result = parseRowsUniversal(fx.rows, 'tria');
    const topups = result.parsed.filter(p => p.type === 'topup');
    const topupsWithCb = topups.filter(t => t.inlineCashback > 0);
    expect(topupsWithCb.length).toBe(0);
  });

  test('parses Tria date format correctly', () => {
    const result = parseRowsUniversal(fx.rows, 'tria');
    const dates = result.parsed.map(p => p.date);
    // All dates should be valid YYYY-MM-DD
    const allValid = dates.every(d => /^\d{4}-\d{2}-\d{2}$/.test(d));
    expect(allValid).toBe(true);
  });
});

describe('Adapter › MetaMask', () => {
  const fx = loadFixture('metamask.sample.json');

  test('detects from headers', () => {
    const detected = detectIssuerUniversal(fx.filename, fx.headers);
    expect(detected).toBe('metamask');
  });

  test('parses all 258 rows', () => {
    const result = parseRowsUniversal(fx.rows, 'metamask');
    expect(result.parsed.length).toBe(258);
    expect(result.skipped.length).toBe(0);
  });

  test('all 258 classified as expense (MetaMask export only has spends)', () => {
    const result = parseRowsUniversal(fx.rows, 'metamask');
    const expenses = result.parsed.filter(p => p.type === 'expense').length;
    expect(expenses).toBe(258);
  });

  test('extracts cashback from "Funding Tokens" reward portion', () => {
    const result = parseRowsUniversal(fx.rows, 'metamask');
    const withCb = result.parsed.filter(p => p.inlineCashback > 0);
    // From the real data: 243 rows have reward in funding tokens
    expect(withCb.length).toBe(243);
  });

  test('fundingAsset is USDC', () => {
    const result = parseRowsUniversal(fx.rows, 'metamask');
    const first = result.parsed[0];
    expect(first.fundingAsset).toBe('USDC');
    expect(first.fundingNetwork).toBe('linea');
  });
});

describe('Adapter › detection edge cases', () => {
  test('returns null when no adapter matches', () => {
    const detected = detectIssuerUniversal('random.csv', ['foo', 'bar', 'baz']);
    expect(detected).toBeNull();
  });

  test('detectIssuerFromImport (compat layer) works the same', () => {
    const fx = loadFixture('etherfi.sample.json');
    const detected = detectIssuerFromImport(fx.filename, fx.headers);
    expect(detected).toBe('etherfi');
  });
});
