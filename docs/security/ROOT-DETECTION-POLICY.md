# Root / Jailbreak / Tamper Detection — Policy Decision Needed

**Finding (MEDIUM, MASVS-RESILIENCE-1):** the app ships with **no** root, jailbreak,
tamper, emulator, or Play Integrity detection, and SECURITY.md documents no accepted
risk. For a self-custody wallet holding hot Ark and on-chain seeds, several audit
findings get worse on a rooted device (the MMKV-at-rest findings and the
no-attempt-throttle finding especially).

This is a product-policy decision, not a bug with one right fix. Options:

| Option | What it means | Trade-off |
|---|---|---|
| **A. Hard block** | Refuse to run on rooted/jailbroken devices (Play Integrity API + jailbreak checks) | Best protection for average users; locks out power users, custom-ROM users, and some threat-model-driven users who root *for* security |
| **B. Warn-and-continue (common for wallets)** | Detect root/jailbreak, show a prominent one-time warning that device integrity is compromised and hot-wallet funds are at higher risk, let the user continue | Respects sovereignty; converts a silent risk into an informed one |
| **C. Documented accepted risk** | No detection; SECURITY.md states that device integrity is the user's responsibility | Zero code; weakest posture, but honest |

**Recommendation:** B for the hot custodial balances (CoinOS/Strike) and A-or-B for
seed-bearing wallets, implemented behind Play Integrity on Android and jailbreak
detection on iOS. Whichever option is chosen, record it in SECURITY.md so the posture
is a decision, not an omission.
