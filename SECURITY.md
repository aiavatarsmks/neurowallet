# Security Policy — NeuroWallet

## Supported Versions

| Version | Supported |
|---------|-----------|
| MVP (current) | ✅ |

## Reporting a Vulnerability

**Please do NOT open a public GitHub issue for security vulnerabilities.**

Contact us privately:

- **Email:** akela1308@gmail.com
- **Subject:** `[SECURITY] NeuroWallet — <brief description>`
- **Response time:** We will acknowledge within 48 hours and provide a fix timeline within 7 days for critical issues.

## What to Include in Your Report

1. Description of the vulnerability
2. Steps to reproduce
3. Potential impact assessment
4. Suggested fix (optional)

## Scope

In scope:
- NeuroWallet frontend (Next.js)
- NeuroWallet backend API
- Wallet key generation and storage
- Authentication and session management
- Transaction logic

Out of scope:
- Third-party services (Supabase, Vercel, Anthropic)
- Social engineering attacks
- Physical device attacks

## Disclosure Policy

- We follow coordinated disclosure: please give us 90 days to fix before public disclosure
- We will credit researchers who report valid vulnerabilities (if desired)
- We do not take legal action against good-faith security researchers

## Security Best Practices for Users

- Never share your seed phrase with anyone — NeuroWallet staff will never ask for it
- Use a strong, unique password
- Enable MFA when available
- Verify the URL is exactly `neurowallet.app` before entering credentials
- Keep your device and browser up to date
