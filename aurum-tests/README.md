# Aurum — Test Infrastructure

This directory contains the testing infrastructure for Aurum's domain logic
(tax classification, adapters, FIFO).

## Why this exists

The main app lives in a single HTML file (`defi-ghost-tracker-v2.html`) and runs
in the browser. That's great for distribution but **terrible for testing** —
DOM dependencies, localStorage, async fetch, etc. make it impossible to verify
fiscal correctness automatically.

This `aurum-tests/` directory **extracts the pure domain logic** from the HTML
into Node-compatible modules under `src/`, then runs a comprehensive test suite
that ensures:

- ✅ Tax classification is correct for every issuer
- ✅ Cashbacks always create new lots (basis = EUR at receipt)
- ✅ Loan-funded spends are NEVER disposals
- ✅ DECLINED is always ignored
- ✅ Permuta cripto-cripto (vault/swap) is never taxable
- ✅ Real CSV/XLSX files parse to expected counts

**Without these tests, fiscal regressions go undetected.** A user with €10k of
disposals classified incorrectly is a lawsuit waiting to happen.

## Architecture

```
defi-ghost-tracker-v2.html   ← single source of truth (the actual app)
        │
        ▼ scripts/sync-from-html.py extracts pure functions
        │
src/universal-adapters.js    ← per-issuer row parsers (pure)
src/classifier.js            ← tax classifier (pure)
        │
        ▼ node tests/run-all.js
        │
tests/_runner.js             ← minimal test framework (no deps)
tests/classifier.test.js     ← 22 tests for tax classification
tests/adapters.test.js       ← 28 tests for parsers + helpers
tests/integration.test.js    ← 10 tests for end-to-end pipeline
fixtures/*.json              ← real exports from ether.fi, Tria, MetaMask
```

## Workflow

```bash
# 1. Edit the HTML normally
vim defi-ghost-tracker-v2.html

# 2. Sync the changes into the testable modules
python3 scripts/sync-from-html.py

# 3. Run the tests
node tests/run-all.js

# Expected output:
# ✓ 60/60 PASSED
```

## What's covered

### Classifier (22 tests)
- Status filtering: DECLINED, FAILED → ignored; CLEARED, PENDING → process
- Card funding: own → disposal/stable_pass; loan → loan_spend; mixed/unknown → pending
- Type-specific treatment: cashback, vault, swap, bridge, topup, withdrawal
- Batch aggregation: counts, null-row handling

### Adapters (28 tests)
- Date parsing: ISO, ether.fi UTC suffix, Tria AM/PM, US format, date-only
- Amount parsing: `$0.28`, `€10.00`, `EUR 15.99`, `USD 36.89`
- ether.fi: detection, 13/13 parsing, inline cashbacks
- Tria: detection, 73/73 parsing, expense/topup split
- MetaMask: detection, 258/258 parsing, cashback from Funding Tokens

### Integration (10 tests)
- End-to-end pipelines for all 3 issuers
- Tax invariants that MUST hold

## Adding new tests

When you fix a bug or add a feature, add a regression test:

```js
// tests/some-area.test.js
const { describe, test, expect } = require('./_runner');
const { classifyTransaction } = require('../src/classifier');

describe('Bug #123: Tria topups must not be taxable', () => {
  test('Tria Credit row is topup, not disposal', () => {
    const c = classifyTransaction(/* ... */);
    expect(c.taxTreatment).toBe('transfer_internal');
  });
});
```

Then: `python3 scripts/sync-from-html.py && node tests/run-all.js`.

## CI

The `.github/workflows/test.yml` runs all tests on every push.
If tests fail, the PR cannot merge.
