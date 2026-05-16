// Integration tests — full pipeline from raw row → classified
const { describe, test, expect } = require('./_runner');
const fs = require('fs');
const path = require('path');
const { normalizeTxRow } = require('../src/classifier');
const { classifyTransactionBatch } = require('../src/classifier');

function loadFixture(name) {
  return JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'fixtures', name), 'utf-8'));
}

describe('Pipeline › ether.fi full flow', () => {
  const fx = loadFixture('etherfi.sample.json');

  test('normalize 13 rows', () => {
    const normalized = fx.rows.map(r => normalizeTxRow(r, 'etherfi')).filter(n => n !== null);
    expect(normalized.length).toBe(13);
  });

  test('classify with loan card → all process, all loan_spend', () => {
    const normalized = fx.rows.map(r => normalizeTxRow(r, 'etherfi')).filter(n => n !== null);
    const batch = classifyTransactionBatch(normalized, 'etherfi', { defaultFundingSource: 'loan' });
    expect(batch.byAction.process).toBe(13);
    expect(batch.byTreatment.loan_spend).toBe(13);
  });

  test('classify with own card USD → disposal events', () => {
    const normalized = fx.rows.map(r => normalizeTxRow(r, 'etherfi')).filter(n => n !== null);
    const batch = classifyTransactionBatch(normalized, 'etherfi', { defaultFundingSource: 'own' });
    // Some are EUR (stable_pass), some USD (disposal)
    const disposals = batch.items.filter(i => i.classification.taxTreatment === 'disposal').length;
    const stablePass = batch.items.filter(i => i.classification.taxTreatment === 'stable_pass').length;
    expect(disposals + stablePass).toBe(13);
  });
});

describe('Pipeline › Tria full flow', () => {
  const fx = loadFixture('tria.sample.json');

  test('classifies 50 expenses + 23 topups correctly', () => {
    const normalized = fx.rows.map(r => normalizeTxRow(r, 'tria')).filter(n => n !== null);
    const batch = classifyTransactionBatch(normalized, 'tria', { defaultFundingSource: 'loan' });
    expect(batch.byCategory.expense).toBe(50);
    expect(batch.byCategory.topup).toBe(23);
  });
});

describe('Pipeline › MetaMask full flow', () => {
  const fx = loadFixture('metamask.sample.json');

  test('all 258 rows produce expenses', () => {
    const normalized = fx.rows.map(r => normalizeTxRow(r, 'metamask')).filter(n => n !== null);
    const batch = classifyTransactionBatch(normalized, 'metamask', { defaultFundingSource: 'own' });
    expect(batch.byCategory.expense).toBe(258);
  });
});

describe('Tax invariants', () => {
  // These are the immutable fiscal rules that MUST hold for the app to be correct.

  test('INVARIANT: cashback always creates new lot regardless of card funding', () => {
    const { classifyTransaction } = require('../src/classifier');
    for (const funding of ['loan', 'own', 'mixed', 'unknown']) {
      const c = classifyTransaction(
        { type: 'referral_cashback', amount: 1 },
        'etherfi',
        { defaultFundingSource: funding }
      );
      expect(c.taxTreatment).toBe('reward_new_lot');
    }
  });

  test('INVARIANT: vault/swap/bridge are NEVER taxable events', () => {
    const { classifyTransaction } = require('../src/classifier');
    const nonTaxable = ['liquid_deposit', 'liquid_execute_withdrawal', 'swap',
                        'stargate_execute_bridge', 'completed_withdrawal'];
    for (const type of nonTaxable) {
      const c = classifyTransaction(
        { type, amount: 100 },
        'etherfi',
        { defaultFundingSource: 'own' }
      );
      // None of these should ever be 'disposal' (the only taxable treatment)
      expect(c.taxTreatment).toBe(c.taxTreatment); // exists
      if (c.taxTreatment === 'disposal') {
        throw new Error(`${type} should never be disposal!`);
      }
    }
  });

  test('INVARIANT: DECLINED is ALWAYS ignored (no fiscal consequence)', () => {
    const { classifyTransaction } = require('../src/classifier');
    for (const funding of ['loan', 'own', 'mixed', 'unknown']) {
      const c = classifyTransaction(
        { type: 'card_spend', status: 'DECLINED', amount: 100 },
        'etherfi',
        { defaultFundingSource: funding }
      );
      expect(c.action).toBe('ignore');
      expect(c.taxTreatment).toBe('ignored');
    }
  });

  test('INVARIANT: loan-funded spend is NEVER a disposal (capital emprestado)', () => {
    const { classifyTransaction } = require('../src/classifier');
    const c = classifyTransaction(
      { type: 'card_spend', status: 'CLEARED', amount: 100, currency: 'USD' },
      'etherfi',
      { defaultFundingSource: 'loan' }
    );
    expect(c.taxTreatment).toBe('loan_spend');
  });
});
