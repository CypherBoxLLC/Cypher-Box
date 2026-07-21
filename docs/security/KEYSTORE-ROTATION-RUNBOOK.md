# Keystore Rotation Runbook (CRITICAL — do first)

**Why:** two Android signing keystores and their plaintext passwords were committed
to this public repository's history and remain retrievable by anyone. Deleting them
from the working tree (commit `73f086a`) did **not** remove them from history:

- Blobs `5663d6dd` and `872c6bfb` (both PKCS#12 keystores, ~2.7 KB each)
- `android/gradle.properties` history shows `MYAPP_RELEASE_STORE_PASSWORD=Cypherbox`
  (and a second password `CypherBox2026` per the same history)

Until disproven, treat both keystores and both passwords as compromised.

## 1. Rotate the Play upload key (owner action, ~30 min)

1. Play Console → **Release → Setup → App integrity → Upload key certificate**.
2. **Request upload key reset** (Google support flow; typically approved in 1–2 days).
3. Generate the replacement locally, never in CI output or a tracked path:
   ```bash
   keytool -genkeypair -v -keystore ~/cypherbox-keystores/cypherbox-upload-2026.keystore \
     -alias upload -keyalg RSA -keysize 4096 -validity 10950
   ```
4. Export the PEM certificate and upload it to the reset request:
   ```bash
   keytool -export -rfc -keystore ~/cypherbox-keystores/cypherbox-upload-2026.keystore \
     -alias upload -file upload_certificate.pem
   ```
5. Store the new keystore + passwords in the team password manager. The keystore
   and its passwords must never be committed, echoed, or placed in CI artifacts.

## 2. Rotate every adjacent secret

- GitHub repo secrets `KEYSTORE_FILE_HEX` / `KEYSTORE_PASSWORD` (used by the release
  flow) → regenerate from the NEW keystore only after step 1 completes.
- The passwords `Cypherbox` / `CypherBox2026`: change them **everywhere they were
  reused** (keystores, stores, accounts). Password reuse is the usual escalation path.

## 3. Purge the keystores from git history

History rewrite requires a coordinated force-push. All contributors must re-clone
or hard-reset afterwards.

```bash
# Mirror-clone, then use BFG (https://rtyley.github.io/bfg-repo-cleaner/)
git clone --mirror git@github.com:CypherBoxLLC/Cypher-Box.git
bfg --delete-files 'cypherbox-release.keystore' Cypher-Box.git
bfg --delete-files 'my-release-key.keystore' Cypher-Box.git
# Scrub the passwords from every historical text file
bfg --replace-text <(printf 'Cypherbox==>REMOVED\nCypherBox2026==>REMOVED\n') Cypher-Box.git
cd Cypher-Box.git && git reflog expire --expire=now --all && git gc --prune=now --aggressive
git push --force
```

Then ask GitHub support to drop cached views of the pre-purge commits, and treat any
fork as still carrying the secrets (rotation in steps 1–2 is what actually closes the
exposure; the purge is hygiene).

## 4. Prevent recurrence

- `.gitignore` already covers `*.jks` / `keystore.properties` — verify it also covers
  `*.keystore` (any name), and keep it that way.
- The PR gitleaks gate should additionally scan for keystore magic bytes; consider
  pinning the gitleaks config to the base branch (see companion finding on the
  gate reading config from the PR's own checkout).
- Local keystores live only in `~/cypherbox-keystores/` (already your convention) —
  that path must stay outside any repo.

## Verification when done

- Play Console shows the new upload key certificate fingerprint.
- `git log --all -p -- android/gradle.properties | grep -i password` finds nothing
  post-purge; `git cat-file -t 5663d6dd` errors (object gone).
- A fresh clone contains no keystore blobs: `git rev-list --objects --all | grep -i keystore`.
