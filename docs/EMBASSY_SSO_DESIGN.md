# Embassy SSO — Final Design (Shared Secret Flow)

## Your intent (confirmed)

1. **One shared secret** in both Embassy `.env` and FMS `.env` (same string on both sides).
2. User clicks button in Embassy → Embassy mints a JWT token signed with the shared secret.
3. FMS receives the token → **verifies** it (not just decode) using the same shared secret.
4. FMS looks up the user by email (or external_id) in its own DB.
   - If **not found** → auto-create the user with claims from the token.
   - If **found** → use existing user.
5. FMS mints its own access token → returns to the client.
6. Client stores the FMS access token and uses it for subsequent API calls.

---

## Decisions (locked defaults — change here if different)

| # | Decision | Value | Why |
|---|---|---|---|
| 1 | Signing algorithm | **HS256** (shared secret) | Matches "same string in both .env" |
| 2 | Verification | `jwt.verify()` | Never just decode — signature check mandatory |
| 3 | User identifier for lookup | **external_id** (Embassy user_id), email as fallback | Immutable; email can change |
| 4 | Unknown user | **Auto-create** in FMS | Zero manual sync between Embassy and FMS |
| 5 | Auto-create default role | **employee** | Safe default; admins can promote in FMS later |
| 6 | tenant_id source | **Required in Embassy token** | FMS cannot guess the tenant otherwise |
| 7 | Access token TTL | 12 hours (current FMS default) | No change needed |
| 8 | Timestamp storage | JWT `exp` claim (automatic) + optional `last_login_at` on users table | No separate timestamp table needed |
| 9 | Replay prevention | Skipped for now (long-lived access tokens, cost > benefit at this scale) | Can add `jti` cache later if required |
| 10 | Response destination | Direct to mobile client | Mobile stores + uses token itself |

---

## Required claims in Embassy token

Embassy backend must include these when signing the JWT:

```json
{
  "sub": "42",                    // Embassy user_id — stored as external_id in FMS
  "email": "user@acme.com",       // for display + fallback lookup
  "name": "Rohit Pandey",         // for auto-create
  "tenant_id": 5,                 // REQUIRED — FMS needs this to scope the user
  "organisation_id": 5,           // OPTIONAL — defaults to tenant's default org
  "role_hint": "employee",        // OPTIONAL — defaults to "employee" if missing
  "iss": "embassy",               // issuer identifier
  "aud": "fms",                   // audience (which service this token is for)
  "exp": 1793520000,              // expiry (Unix epoch seconds)
  "iat": 1790928000               // issued-at
}
```

Signed with: `jwt.sign(payload, SHARED_SECRET, { algorithm: 'HS256' })`

---

## Flow diagram

```
┌─────────────────────────────────────────────────────────────┐
│ Embassy backend  ───mint JWT───▶  Embassy UI / Mobile app   │
│   HS256 w/ shared secret                                    │
└─────────────────────────────────────────────────────────────┘
                                              │
                                              │ POST /api/auth/sso/embassy
                                              │ { token: "eyJ..." }
                                              ▼
┌─────────────────────────────────────────────────────────────┐
│ FMS backend                                                 │
│                                                             │
│   Step 1 — Verify                                           │
│     jwt.verify(token, SHARED_SECRET, {                      │
│       algorithms: ['HS256'],                                │
│       issuer: 'embassy',                                    │
│       audience: 'fms'                                       │
│     })                                                      │
│     → throws if tampered / expired / wrong issuer           │
│                                                             │
│   Step 2 — Look up user                                     │
│     user = SELECT * FROM users WHERE external_id = sub      │
│                                                             │
│   Step 3 — Auto-create if missing                           │
│     IF NOT user:                                            │
│       INSERT INTO users (                                   │
│         external_id, email, name,                           │
│         tenant_id, organisation_id, role                    │
│       ) VALUES (                                            │
│         payload.sub, payload.email, payload.name,           │
│         payload.tenant_id,                                  │
│         payload.organisation_id OR default_org_for_tenant,  │
│         payload.role_hint OR 'employee'                     │
│       )                                                     │
│                                                             │
│   Step 4 — Mint FMS access token                            │
│     fmsToken = jwt.sign(user, FMS_SECRET, { expiresIn: 12h })│
│                                                             │
│   Step 5 — Respond                                          │
│     { access_token: fmsToken, user: {...} }                 │
└─────────────────────────────────────────────────────────────┘
                                              │
                                              ▼
┌─────────────────────────────────────────────────────────────┐
│ Mobile / Embassy UI                                         │
│   Stores access_token                                       │
│   Uses it for Authorization: Bearer <access_token>          │
└─────────────────────────────────────────────────────────────┘
```

---

## Environment variables

**Embassy .env:**
```
FMS_SSO_SHARED_SECRET=<long-random-string-at-least-32-chars>
```

**FMS .env:**
```
EMBASSY_SSO_ENABLED=true
EMBASSY_SHARED_SECRET=<same-long-random-string>
EMBASSY_ISSUER=embassy
EMBASSY_AUDIENCE=fms
EMBASSY_CLOCK_TOLERANCE_SEC=60
```

**Generate the shared secret once:**
```
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```
Paste the output into both `.env` files.

---

## Changes needed in existing FMS code (vs. what's currently built)

Current build uses RS256 (public/private key pair). To switch to HS256 shared secret:

### 1. `backend/src/config/index.js`
Replace the `embassy` section:
```javascript
embassy: {
  ssoEnabled:        String(process.env.EMBASSY_SSO_ENABLED || 'false').toLowerCase() === 'true',
  sharedSecret:      process.env.EMBASSY_SHARED_SECRET || '',
  issuer:            process.env.EMBASSY_ISSUER   || 'embassy',
  audience:          process.env.EMBASSY_AUDIENCE || 'fms',
  clockToleranceSec: parseInt(process.env.EMBASSY_CLOCK_TOLERANCE_SEC || '60', 10),
},
```

### 2. `backend/src/middleware/embassySso.js`
Replace `loadPublicKey()` with secret lookup:
```javascript
function verifyHandoffToken(token) {
  const secret = config.embassy.sharedSecret;
  if (!secret) throw new EmbassySsoError('EMBASSY_SSO_NO_SECRET', 'Shared secret not configured', 500);

  const decoded = jwt.verify(token, secret, {
    algorithms: ['HS256'],
    issuer:   config.embassy.issuer,
    audience: config.embassy.audience,
    clockTolerance: config.embassy.clockToleranceSec,
  });
  return decoded;
}
```

### 3. `backend/src/modules/auth/sso.controller.js`
Replace "reject unknown user" with "auto-create":
```javascript
let user = await loadUserByExternalId(decoded.sub);
if (!user) {
  user = await createFmsUserFromEmbassyClaims(decoded);
}
```

### 4. `backend/scripts/mint-test-handoff.js`
Change signing from RS256 private key → HS256 shared secret:
```javascript
const token = jwt.sign(payload, config.embassy.sharedSecret, {
  algorithm: 'HS256',
  issuer: config.embassy.issuer,
  audience: config.embassy.audience,
  expiresIn: ttl,
  jwtid: crypto.randomUUID(),
});
```

### 5. `backend/.env.example`
Replace Embassy section with shared-secret vars (see above).

### 6. Delete (no longer needed):
- `backend/scripts/gen-embassy-keypair.js` (keypair generation)
- `backend/certs/` folder (keys)

---

## Testing (how to verify end-to-end)

1. **Generate secret:**
   ```
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```

2. **Add to .env:**
   ```
   EMBASSY_SSO_ENABLED=true
   EMBASSY_SHARED_SECRET=<paste-output-here>
   EMBASSY_ISSUER=embassy
   EMBASSY_AUDIENCE=fms
   ```

3. **Restart backend.**

4. **Mint a test token:**
   ```
   node backend/scripts/mint-test-handoff.js --user-id 999 --email new@test.com --tenant-id 5
   ```
   (Pass a user_id that doesn't exist in FMS to test auto-create.)

5. **Exchange via Postman:**
   ```
   POST http://localhost:4002/api/auth/sso/embassy
   { "token": "<minted-token>" }
   ```
   → Should return `{ access_token: "...", user: {...} }`.

6. **Verify user was created:**
   ```sql
   SELECT id, external_id, email, name, role, tenant_id FROM users WHERE external_id = '999';
   ```

7. **Use the access token:**
   ```
   GET http://localhost:4002/api/demo
   Authorization: Bearer <access_token>
   ```
   → Should return the authenticated user info.

---

## Things to tell the Embassy team

1. **They sign the token** with the shared secret using HS256:
   ```
   jwt.sign(payload, FMS_SSO_SHARED_SECRET, { algorithm: 'HS256' })
   ```

2. **They include these claims** in the payload:
   - `sub` (Embassy user_id)
   - `email`
   - `name`
   - `tenant_id` ← critical
   - `organisation_id` (optional)
   - `role_hint` (optional, defaults to 'employee')
   - `iss: 'embassy'`
   - `aud: 'fms'`
   - `exp` (short — 60-300 seconds is enough)

3. **They send the token to the mobile client** (not server-to-server to FMS).

4. **The mobile client calls** `POST /api/auth/sso/embassy` with the token.

5. **Shared secret rotation plan**: coordinate downtime window with FMS, change in both .env files together.
