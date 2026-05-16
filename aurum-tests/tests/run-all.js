#!/usr/bin/env node
// Run all tests in the tests/ directory
// Usage: node tests/run-all.js

const fs = require('fs');
const path = require('path');
const { run } = require('./_runner');

const testsDir = __dirname;
const files = fs.readdirSync(testsDir)
  .filter(f => f.endsWith('.test.js'))
  .sort();

console.log(`Loading ${files.length} test files:`);
for (const f of files) {
  console.log(`  - ${f}`);
  require(path.join(testsDir, f));
}

run();
