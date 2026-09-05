# Dependency risk register

Last reviewed: 2026-09-05

## Baseline

- Production dependency audit command: `npm audit --omit=dev`
- Current result after upgrading Next.js 16.3.4 and Firebase Admin 14.3.0: **0 high, 6 moderate, 0 critical**.
- The audit result is intentionally tracked separately from dev-tooling advisories.

## Policy

- Apply semver-compatible security patches in a dedicated PR.
- Upgrade major versions only with a full test/build gate and production smoke check.
- Do not run `npm audit fix --force` as an unattended remediation strategy.
- Keep advisory URLs and package versions in the PR description when changing dependencies.
- Re-run the production-only audit after every dependency PR.

## Current disposition

- Next.js advisories: resolved by `16.3.4`.
- Firebase Admin / Google Cloud advisories: high-severity chain resolved by `firebase-admin@14.3.0`; remaining moderate advisories are transitive and require individual review.
- Remaining moderate advisories: monitor through Dependabot and review each proposed fix; do not claim zero vulnerabilities until `npm audit --omit=dev` confirms it.

## Verification commands

```bash
npm audit --omit=dev
npm test
npx tsc --noEmit
npm run lint
npm run build
git diff --check
```
