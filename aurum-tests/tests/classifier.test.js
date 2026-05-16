// Classifier tests — pure tax classification logic
const { describe, test, expect } = require('./_runner');
const { classifyTransaction, classifyTransactionBatch, TX_CATEGORIES } = require('../src/classifier');

describe('classifyTransaction › status filtering', () => {
  test('DECLINED card spend is ignored', () => {
    const c = classifyTransaction(
      { type: 'card_spend', status: 'DECLINED', amount: 50 },
      'etherfi',
      { defaultFundingSource: 'loan' }
    );
    expect(c.category).toBe(TX_CATEGORIES.DECLINED);
    expect(c.action).toBe('ignore');
    expect(c.taxTreatment).toBe('ignored');
  });

  test('FAILED is ignored too', () => {
    const c = classifyTransaction(
      { type: 'card_spend', status: 'FAILED', amount: 50 },
      'etherfi',
      { defaultFundingSource: 'loan' }
    );
    expect(c.action).toBe('ignore');
  });

  test('CLEARED is processed', () => {
    const c = classifyTransaction(
      { type: 'card_spend', status: 'CLEARED', amount: 10 },
      'etherfi',
      { defaultFundingSource: 'loan' }
    );
    expect(c.action).toBe('process');
  });

  test('PENDING is processed', () => {
    const c = classifyTransaction(
      { type: 'card_spend', status: 'PENDING', amount: 10 },
      'etherfi',
      { defaultFundingSource: 'loan' }
    );
    expect(c.action).toBe('process');
  });
});

describe('classifyTransaction › card funding source', () => {
  test('LOAN-funded card spend → loan_spend (not taxable)', () => {
    const c = classifyTransaction(
      { type: 'card_spend', status: 'CLEARED', amount: 40, currency: 'EUR' },
      'etherfi',
      { defaultFundingSource: 'loan' }
    );
    expect(c.category).toBe(TX_CATEGORIES.EXPENSE);
    expect(c.taxTreatment).toBe('loan_spend');
  });

  test('OWN-funded card spend with USD → disposal (Cat. G)', () => {
    const c = classifyTransaction(
      { type: 'card_spend', status: 'CLEARED', amount: 40, currency: 'USD', originalCurrency: 'USD' },
      'etherfi',
      { defaultFundingSource: 'own' }
    );
    expect(c.category).toBe(TX_CATEGORIES.EXPENSE);
    expect(c.taxTreatment).toBe('disposal');
  });

  test('OWN-funded card spend in EUR stable → stable_pass', () => {
    const c = classifyTransaction(
      { type: 'card_spend', status: 'CLEARED', amount: 40, currency: 'EUR', originalCurrency: 'EUR' },
      'etherfi',
      { defaultFundingSource: 'own' }
    );
    expect(c.taxTreatment).toBe('stable_pass');
  });

  test('UNKNOWN funding source → pending', () => {
    const c = classifyTransaction(
      { type: 'card_spend', status: 'CLEARED', amount: 40 },
      'etherfi',
      { defaultFundingSource: 'unknown' }
    );
    expect(c.action).toBe('pending');
  });

  test('MIXED funding requires per-topup confirm', () => {
    const c = classifyTransaction(
      { type: 'card_spend', status: 'CLEARED', amount: 40 },
      'etherfi',
      { defaultFundingSource: 'mixed' }
    );
    expect(c.action).toBe('pending');
  });
});

describe('classifyTransaction › type-specific treatment', () => {
  test('referral_cashback → reward_new_lot (always, regardless of card funding)', () => {
    const c1 = classifyTransaction(
      { type: 'referral_cashback', status: '', amount: 0.5 },
      'etherfi',
      { defaultFundingSource: 'loan' }
    );
    expect(c1.category).toBe(TX_CATEGORIES.CASHBACK);
    expect(c1.taxTreatment).toBe('reward_new_lot');

    const c2 = classifyTransaction(
      { type: 'referral_cashback', status: '', amount: 0.5 },
      'etherfi',
      { defaultFundingSource: 'own' }
    );
    expect(c2.taxTreatment).toBe('reward_new_lot');
  });

  test('liquid_deposit (vault) → permuta, no event', () => {
    const c = classifyTransaction(
      { type: 'liquid_deposit', status: '', amount: 1000, description: 'WETH' },
      'etherfi',
      { defaultFundingSource: 'own' }
    );
    expect(c.category).toBe(TX_CATEGORIES.VAULT_IN);
    expect(c.taxTreatment).toBe('permuta_no_event');
  });

  test('swap → permuta, no event (Art. 10 nº 6 c)', () => {
    const c = classifyTransaction(
      { type: 'swap', status: '', amount: 100 },
      'etherfi',
      { defaultFundingSource: 'own' }
    );
    expect(c.category).toBe(TX_CATEGORIES.SWAP);
    expect(c.taxTreatment).toBe('permuta_no_event');
  });

  test('stargate_execute_bridge → transfer_internal', () => {
    const c = classifyTransaction(
      { type: 'stargate_execute_bridge', status: '', amount: 100 },
      'etherfi',
      { defaultFundingSource: 'own' }
    );
    expect(c.category).toBe(TX_CATEGORIES.BRIDGE);
    expect(c.taxTreatment).toBe('transfer_internal');
  });

  test('topup → transfer_internal (no fiscal event)', () => {
    const c = classifyTransaction(
      { type: 'topup', status: '', amount: 5000 },
      'etherfi',
      { defaultFundingSource: 'own' }
    );
    expect(c.category).toBe(TX_CATEGORIES.TOPUP);
    expect(c.taxTreatment).toBe('transfer_internal');
  });

  test('unknown type → pending classification', () => {
    const c = classifyTransaction(
      { type: 'unknown_weird_type', status: 'CLEARED', amount: 50 },
      'etherfi',
      { defaultFundingSource: 'loan' }
    );
    expect(c.category).toBe(TX_CATEGORIES.UNKNOWN);
    expect(c.action).toBe('pending');
  });
});

describe('classifyTransactionBatch › aggregates', () => {
  test('counts categories correctly', () => {
    const rows = [
      { type: 'card_spend', status: 'CLEARED', amount: 10 },
      { type: 'card_spend', status: 'CLEARED', amount: 20 },
      { type: 'card_spend', status: 'DECLINED', amount: 30 },
      { type: 'referral_cashback', status: '', amount: 1 },
      { type: 'topup', status: '', amount: 1000 },
    ];
    const batch = classifyTransactionBatch(rows, 'etherfi', { defaultFundingSource: 'loan' });
    expect(batch.total).toBe(5);
    expect(batch.byCategory.expense).toBe(2);
    expect(batch.byCategory.declined).toBe(1);
    expect(batch.byCategory.cashback).toBe(1);
    expect(batch.byCategory.topup).toBe(1);
    expect(batch.byAction.process).toBe(4);
    expect(batch.byAction.ignore).toBe(1);
  });

  test('skips null rows from adapter', () => {
    const batch = classifyTransactionBatch(
      [null, { type: 'topup', status: '', amount: 1 }, undefined],
      'etherfi',
      { defaultFundingSource: 'loan' }
    );
    expect(batch.skippedNullRows).toBe(2);
    expect(batch.items.length).toBe(1);
  });
});
