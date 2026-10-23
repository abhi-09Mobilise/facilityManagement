# Embassy Team — FMS SSO Integration Instructions

Hi Embassy team,

The FMS backend is ready to accept your single sign-on handoff tokens.
This document covers everything you need to build on your side.

---

## High-level flow

```
User (logged into Embassy)
   │
   │ Clicks "Open FMS" button in Embassy UI
   ▼
Embassy frontend
   │
   │ POST https://embassy.app/api/sso/fms-handoff
   │ (your Embassy session cookie / JWT attached)
   ▼
Embassy backend                      ← YOU BUILD THIS
   │
   │ 1. Verify the user's Embassy session
   │ 2. Mint a short-lived HS256 JWT signed with the SHARED SECRET
   │ 3. Return the JWT to the frontend
   ▼
Embassy / mobile client
   │
   │ POST https://fms.onmobilise.com/api/auth/sso/embassy
   │ Body: { handoff_token: "<the_jwt>" }
   ▼
FMS backend                          ← already built, no action needed
   │
   │ Verifies the token with the SAME shared secret
   │ Looks up user in FMS DB by `email` claim
   │ Mints FMS access token (12 hours)
   │
   │ Response: { token, user }
   ▼
Client stores FMS access token and uses it for all FMS API calls.
```

---

## Your deliverables (checklist)

- [ ] Agree on a shared secret with the FMS team (one string, both sides use it)
- [ ] Store the shared secret in Embassy's secret manager (env var, Vault, etc.) — never commit
- [ ] Build `POST /api/sso/fms-handoff` endpoint on your backend
- [ ] Add the "Open FMS" button in Embassy UI with the two API calls (handoff → exchange)
- [ ] Ensure the user emails in your Embassy user table match the emails in the FMS user table (FMS looks up by email)

---

## 1. Shared secret (one-time setup, both sides)

Generate once, share once, use everywhere:

```
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Produces a 64-character hex string, e.g.:
```
Q5BbijhrsibLq2eb6svhS8v0trROaxwi5sGgwaBXnnzHHOYPWC5mD7eMjSlFb1D3
```

- Paste into Embassy's `.env` as `FMS_SSO_SHARED_SECRET=...`
- FMS team pastes into their `.env` as `EMBASSY_SHARED_SECRET=...`
- Same string, both sides

Treat it like a database password:
- Never log, never commit
- Rotate periodically (e.g. every 6 months) by coordinating a short cutover with the FMS team

---

## 2. Build the handoff endpoint

```
POST /api/sso/fms-handoff
```

### Requirements:
- Must be protected by your normal Embassy auth (session cookie or Embassy JWT)
- Reads the current logged-in user from your Embassy session
- Signs a JWT with the shared secret (HS256)
- Returns `{ handoff_token: "<the_jwt>" }`

### Reference implementation (Node.js + jsonwebtoken):

```javascript
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

const SHARED_SECRET = process.env.FMS_SSO_SHARED_SECRET;

app.post('/api/sso/fms-handoff', requireEmbassyAuth, (req, res) => {
  const user = req.user;   // from your Embassy session middleware

  const token = jwt.sign(
    {
      email: user.email,        // REQUIRED — FMS looks up users by this
      sub:   String(user.id),   // Embassy user id (for audit)
      name:  user.name,         // optional, cosmetic
    },
    SHARED_SECRET,
    {
      algorithm: 'HS256',
      issuer:    'embassy',     // REQUIRED, fixed string
      audience:  'fms',         // REQUIRED, fixed string
      expiresIn: 60,            // 60 seconds is plenty
      jwtid:     crypto.randomUUID(),  // REQUIRED — for replay prevention
    }
  );

  res.json({ handoff_token: token });
});
```

### Equivalent in other languages:
- Python: `pyjwt` with `algorithm='HS256'`
- Java: `jjwt` or `nimbus-jose-jwt`
- Go: `golang-jwt/jwt`
- PHP: `firebase/php-jwt`
- .NET: `System.IdentityModel.Tokens.Jwt`

The output must be a standard HS256 JWT with those claims. Any mature JWT
library produces the same token.

---

## 3. Required JWT claims

Every handoff token your endpoint signs **must** include:

| Claim | Value | Why |
|---|---|---|
| `email` | user's email from Embassy | FMS looks up the user by this |
| `iss` | `"embassy"` (literal) | FMS rejects tokens from other issuers |
| `aud` | `"fms"` (literal) | FMS rejects tokens meant for other services |
| `exp` | 60 seconds in the future | FMS rejects expired tokens (±60s clock tolerance) |
| `jti` | a UUID (unique per token) | FMS rejects reused tokens (replay prevention) |

**Optional claims (useful for audit / future features):**

| Claim | Value | Why |
|---|---|---|
| `sub` | Embassy's internal user id | For audit logs on FMS side |
| `name` | user's display name | Cosmetic; not used for authorization |
| `iat` | current Unix epoch seconds | Audit timestamp |

**Claims FMS deliberately IGNORES:**
- `role` — FMS uses its own role field from the FMS users table
- `tenant_id`, `organisation_id` — resolved from the FMS user record
- Anything else

FMS's authorization decisions are made entirely from the FMS DB after the
user is identified via `email`.

---

## 4. Email alignment (critical)

The `email` claim in your handoff token is the sole identifier FMS uses to
find the user in its DB. Two rules:

1. Every Embassy user who should be able to open FMS **must already exist
   in the FMS `users` table** with a matching email.
2. If a user changes their email on either side, both sides need to
   update — otherwise the next handoff will return 401 "User is not
   provisioned in FMS".

The FMS admin pre-provisions users via FMS's own user management UI. There
is **no auto-provisioning** on FMS — unknown users are rejected.

---

## 5. Frontend wiring (Embassy UI side)

Pseudocode for the "Open FMS" button:

```javascript
async function openFms() {
  // Step 1: get the handoff token from your own backend
  const res1 = await fetch('/api/sso/fms-handoff', {
    method: 'POST',
    credentials: 'include',   // Embassy session cookie
  });
  const { handoff_token } = await res1.json();

  // Step 2: forward it to FMS
  const res2 = await fetch('https://fms.onmobilise.com/api/auth/sso/embassy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ handoff_token }),
  });
  const data = await res2.json();

  if (!data.status) {
    alert('Could not open FMS: ' + data.msg);
    return;
  }

  // Step 3: store the FMS access token (secure storage!)
  // Mobile: iOS Keychain / Android Keystore / expo-secure-store
  // Web:    HttpOnly cookie preferred over localStorage
  await SecureStore.setItem('fms_access_token', data.data.token);

  // Step 4: navigate to the FMS screen / iframe / webview
  // ... whatever your integration looks like
}
```

---

## 6. Testing checklist (before going live)

- [ ] Shared secret pasted into Embassy's `.env` (identical to FMS's copy)
- [ ] `POST /api/sso/fms-handoff` returns a signable JWT when called with a valid Embassy session
- [ ] Decode one of your tokens on https://jwt.io — confirm payload contains `email`, `iss="embassy"`, `aud="fms"`, `exp`, `jti`
- [ ] Pass that token to FMS: `POST /api/auth/sso/embassy { handoff_token }` — expect `200 { token, user }`
- [ ] Decode the FMS access token (jwt.io) — confirm it is an FMS JWT (different signature, different claims)
- [ ] Verify a reused token is rejected (second call with the same `handoff_token` → 401 "replay rejected")
- [ ] Verify an expired token is rejected (wait > 60s then exchange → 401 "expired")
- [ ] Verify a user not in FMS is rejected (mint a token for an email not in the FMS DB → 401 "not provisioned")

---

## 7. Error responses from FMS (to handle in your frontend)

| HTTP | FMS `msg` | Likely cause |
|---|---|---|
| 400 | `Handoff token is missing the required "email" claim` | You forgot to include `email` in payload |
| 401 | `Invalid handoff token: ...` | Signature mismatch — shared secret differs between Embassy and FMS |
| 401 | `Handoff token has expired` | Token > 60s old by the time FMS receives it |
| 401 | `Handoff token already used (replay rejected)` | Same token sent twice; mint a fresh one |
| 401 | `User is not provisioned in FMS. Please contact your administrator.` | Email in token doesn't match any FMS user |
| 403 | `Account is inactive or not approved` | FMS user exists but is disabled |
| 404 | `Embassy SSO is not enabled on this server.` | FMS hasn't finished setup; contact FMS team |
| 429 | `Too many SSO attempts. Please try again later.` | Rate limit (30 attempts / 15 min / IP) |

---

## 8. Secret rotation

When you need to rotate the shared secret:

1. Agree on a cutover window with the FMS team (even 1 minute is enough).
2. FMS team updates `EMBASSY_SHARED_SECRET` in FMS `.env` and restarts.
3. Embassy team updates `FMS_SSO_SHARED_SECRET` in Embassy `.env` and
   restarts simultaneously.
4. Tokens minted during the cutover with the old secret will fail
   verification — short expiries (60s) mean the queue drains in ~1 minute.
5. Communicate to users to retry if they hit a login error during that
   window.

Advanced: FMS could support two secrets simultaneously (old + new) for a
grace period. Not implemented in v1 — ask if you need it.

---

## 9. FAQ

**Q: Do we need to send FMS our private key?**
HS256 has no private key — just one shared secret used by both sides. The
same string goes in both Embassy's `.env` and FMS's `.env`.

**Q: Can we use the same secret across environments?**
Not recommended. Use a different secret per environment
(dev / staging / prod) so a dev leak doesn't compromise prod.

**Q: Does FMS cache the secret?**
It's read from `process.env` at startup, which is effectively a cache for
the process lifetime. If you rotate, both services need a restart.

**Q: Can multiple users share one handoff token?**
No. The `jti` claim ensures each token is single-use. One token per user
per SSO initiation.

**Q: Does FMS need to call back to Embassy to validate the token?**
No. The HS256 signature is self-contained — FMS verifies offline using
only the shared secret. Zero network dependency between the two services
during authentication.

**Q: Is HS256 less secure than RS256?**
For this use case — same organisation, trusted shared secret, short-lived
tokens — HS256 is perfectly fine. The main difference is operational:
HS256 requires shared secret management, RS256 requires public key
distribution. We chose HS256 for simplicity.

---

## 10. Contacts

- FMS backend / API issues: _(FMS team to fill in)_
- Embassy integration questions: _(Embassy team lead)_
- Mobile integration questions: _(mobile team lead)_

---

Thanks — reach out any time with questions or if any part of this doesn't
match your tech stack / preferred patterns. We can adapt.
