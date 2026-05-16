#!/usr/bin/env python3
"""
Sync from HTML — regenerate testable JS modules from the canonical HTML source.

The HTML file (defi-ghost-tracker-v2.html) is the source of truth for the actual app.
This script extracts pure domain functions (classifier, adapters) into Node-compatible
modules under src/ so they can be tested without DOM/browser.

Workflow:
  1. Edit code in the HTML
  2. Run: python3 scripts/sync-from-html.py
  3. Run: node tests/run-all.js
  4. If tests fail, fix the HTML and resync

Usage: python3 scripts/sync-from-html.py [path/to/file.html]
"""
import re
import sys
import os
import subprocess
from pathlib import Path

ROOT = Path(__file__).parent.parent
DEFAULT_HTML = '/mnt/user-data/outputs/defi-ghost-tracker-v2.html'

def extract_section(js, start_marker, end_marker):
    """Extract substring between two markers."""
    si = js.find(start_marker)
    if si < 0:
        return None
    ei = js.find(end_marker, si + len(start_marker))
    if ei < 0:
        return None
    return js[si:ei].rstrip()

def replace_window_exports(code, names, target='module.exports'):
    for name in names:
        code = code.replace(f'window.{name}', f'{target}.{name}')
    return code

def ensure_exports(code, names, target='module.exports'):
    """Add `module.exports.X = X` if not already present."""
    additions = []
    for name in names:
        if f'{target}.{name}' not in code:
            additions.append(f'{target}.{name} = {name};')
    if additions:
        code += '\n\n// Auto-added exports\n' + '\n'.join(additions) + '\n'
    return code

HEADER = '''// AUTO-GENERATED FROM defi-ghost-tracker-v2.html — DO NOT EDIT DIRECTLY
// To resync: python3 scripts/sync-from-html.py
// Edit the HTML, then resync.

'''

def main():
    html_path = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_HTML
    print(f"Reading: {html_path}")
    with open(html_path) as f:
        html = f.read()

    s = html.rfind('<script>') + len('<script>')
    e = html.rfind('</script>')
    js = html[s:e]
    print(f"JS section: {len(js)/1024:.1f} KB ({js.count(chr(10))} lines)")

    # ── Universal adapters ──
    universal = extract_section(
        js,
        '// UNIVERSAL CARD IMPORT',
        '// FASE 6B'
    )
    if not universal:
        print("✗ Could not extract universal adapters section")
        sys.exit(1)

    universal_exports = ['UNIVERSAL_ADAPTERS', 'detectIssuerUniversal', 'parseRowsUniversal',
                         '_parseDateFlexible', '_parseAmountWithCurrency']
    universal_code = replace_window_exports(universal, universal_exports)
    universal_code = ensure_exports(universal_code, universal_exports)

    out_universal = ROOT / 'src' / 'universal-adapters.js'
    out_universal.parent.mkdir(parents=True, exist_ok=True)
    with open(out_universal, 'w') as f:
        f.write(HEADER + universal_code + '\n')
    print(f"✓ src/universal-adapters.js  ({len(universal_code)} chars)")

    # ── Classifier ──
    classifier = extract_section(
        js,
        '// FASE 6B: Transaction Classifier',
        '// FASE 6C'
    )
    if not classifier:
        print("✗ Could not extract classifier section")
        sys.exit(1)

    classifier_exports = ['classifyTransaction', 'classifyTransactionBatch', 'TX_CATEGORIES',
                          'detectIssuerFromImport', 'normalizeTxRow']
    classifier_code = replace_window_exports(classifier, classifier_exports)
    classifier_code = ensure_exports(classifier_code, classifier_exports)

    # Add require for universal-adapters at top
    classifier_module = HEADER
    classifier_module += "const { UNIVERSAL_ADAPTERS, detectIssuerUniversal, _parseDateFlexible, _parseAmountWithCurrency } = require('./universal-adapters');\n"
    classifier_module += "const GENERIC_ADAPTER = UNIVERSAL_ADAPTERS.outro;\n\n"
    classifier_module += classifier_code + '\n'

    out_classifier = ROOT / 'src' / 'classifier.js'
    with open(out_classifier, 'w') as f:
        f.write(classifier_module)
    print(f"✓ src/classifier.js  ({len(classifier_code)} chars)")

    # ── Syntax check ──
    print("\nSyntax check:")
    for f in ['universal-adapters.js', 'classifier.js']:
        path = ROOT / 'src' / f
        r = subprocess.run(['node', '--check', str(path)], capture_output=True, text=True)
        if r.returncode == 0:
            print(f"  ✓ {f}")
        else:
            print(f"  ✗ {f}: {r.stderr[:300]}")
            sys.exit(1)

    print("\n✓ Sync complete. Run: node tests/run-all.js")

if __name__ == '__main__':
    main()
