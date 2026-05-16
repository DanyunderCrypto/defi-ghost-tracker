// Minimal test runner — no deps
// Usage: node tests/run-all.js
//
// Format:
//   const { test, expect, run } = require('./_runner');
//   test('description', () => { expect(actual).toBe(expected); });
//   ...
//   run();  // exits 0/1 based on results

const tests = [];
let currentSuite = '';

function describe(name, fn) {
  const prevSuite = currentSuite;
  currentSuite = prevSuite ? `${prevSuite} › ${name}` : name;
  fn();
  currentSuite = prevSuite;
}

function test(name, fn) {
  tests.push({ suite: currentSuite, name, fn });
}

function expect(actual) {
  return {
    toBe(expected) {
      if (actual !== expected) {
        throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
      }
    },
    toEqual(expected) {
      const a = JSON.stringify(actual);
      const e = JSON.stringify(expected);
      if (a !== e) {
        throw new Error(`Expected ${e}, got ${a}`);
      }
    },
    toBeCloseTo(expected, decimals = 2) {
      const diff = Math.abs(actual - expected);
      const tolerance = Math.pow(10, -decimals);
      if (diff > tolerance) {
        throw new Error(`Expected ${expected} ± ${tolerance}, got ${actual} (diff ${diff})`);
      }
    },
    toBeTruthy() {
      if (!actual) throw new Error(`Expected truthy, got ${JSON.stringify(actual)}`);
    },
    toBeFalsy() {
      if (actual) throw new Error(`Expected falsy, got ${JSON.stringify(actual)}`);
    },
    toBeNull() {
      if (actual !== null) throw new Error(`Expected null, got ${JSON.stringify(actual)}`);
    },
    toBeGreaterThan(expected) {
      if (!(actual > expected)) throw new Error(`Expected > ${expected}, got ${actual}`);
    },
    toContain(expected) {
      if (Array.isArray(actual)) {
        if (!actual.includes(expected)) throw new Error(`Expected array to contain ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
      } else if (typeof actual === 'string') {
        if (!actual.includes(expected)) throw new Error(`Expected string to contain ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
      } else {
        throw new Error('toContain only works on arrays/strings');
      }
    },
  };
}

function run() {
  let pass = 0, fail = 0;
  const failures = [];

  console.log('\n' + '═'.repeat(60));
  console.log('AURUM TEST SUITE');
  console.log('═'.repeat(60));

  let lastSuite = null;
  for (const t of tests) {
    if (t.suite !== lastSuite) {
      console.log(`\n  ${t.suite}`);
      lastSuite = t.suite;
    }
    try {
      t.fn();
      console.log(`    ✓ ${t.name}`);
      pass++;
    } catch (err) {
      console.log(`    ✗ ${t.name}`);
      console.log(`        ${err.message}`);
      fail++;
      failures.push({ name: `${t.suite} › ${t.name}`, error: err });
    }
  }

  console.log('\n' + '─'.repeat(60));
  if (fail === 0) {
    console.log(`✓ ${pass}/${pass} PASSED`);
    console.log('─'.repeat(60));
    process.exit(0);
  } else {
    console.log(`✗ ${fail} FAILED · ${pass} passed (${pass + fail} total)`);
    console.log('─'.repeat(60));
    for (const f of failures) {
      console.log(`\n  FAIL: ${f.name}`);
      console.log(`    ${f.error.stack || f.error.message}`);
    }
    process.exit(1);
  }
}

module.exports = { describe, test, expect, run };
