# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in Aurum, please **do not open a public GitHub issue**.

Instead, report it privately by emailing: **[your-email-here@example.com]**

Or via GitHub's private vulnerability reporting:
1. Go to the [Security tab](../../security/advisories) of this repository
2. Click "Report a vulnerability"

## What to Include

Please include the following information:

- **Type of vulnerability** (e.g., XSS, data leak, logic flaw)
- **Steps to reproduce** the issue
- **Potential impact** (what could an attacker do?)
- **Affected version** (commit hash if possible)
- **Suggested fix** (if you have one)

## What to Expect

- **Acknowledgment**: within 48 hours
- **Initial assessment**: within 7 days
- **Fix timeline**: depends on severity:
  - 🔴 **Critical** (data loss, fund theft): patch within 72 hours
  - 🟠 **High** (PII leak, authentication bypass): patch within 14 days
  - 🟡 **Medium** (UX bugs with security impact): patch within 30 days
  - 🟢 **Low** (theoretical issues): patch in next release

## Disclosure Policy

We follow **coordinated disclosure**:
1. You report privately
2. We fix the issue
3. We deploy the fix
4. We acknowledge your contribution (if you want)
5. After 30 days post-fix, full details may be published

## Scope

In scope:
- The Aurum web app (this repository)
- Tax classification logic
- Data storage (IndexedDB, localStorage)
- API integration security (Alchemy, Mempool.space)
- Privacy/PII handling

Out of scope:
- External services (Alchemy, Mempool.space, etc.) — report to them directly
- User errors (e.g., entering wrong addresses)
- Issues requiring physical access to the user's device

## Security Practices

Aurum follows these principles:

- **Self-custodial**: No private keys, no fund custody, no on-chain transactions initiated by Aurum
- **Local-first**: All data stays in the user's browser (IndexedDB)
- **No backend**: No central server stores user data (until paid tier, where only license keys are stored)
- **Privacy-by-default**: API calls scrubbed of PII before logging
- **Open source**: All code is auditable

## Known Limitations

- **API privacy trade-offs**: Alchemy/Mempool.space see queried addresses. This is documented in the FAQ.
- **Browser security model**: Aurum cannot protect against compromised browsers or malicious extensions.
- **User responsibility**: The accuracy of tax calculations depends on data the user imports.

## Bug Bounty

We do not currently run a paid bug bounty program. We may add one when the project reaches >1000 users.

For now, security researchers will be acknowledged in:
- The repository's `SECURITY.md` Hall of Fame (with permission)
- Release notes for the fix

Thank you for helping keep Aurum and its users safe.
