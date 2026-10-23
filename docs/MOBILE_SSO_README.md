# FMS Embassy SSO — Mobile Team Quick Start

This guide is for the mobile team integrating the FMS SSO login flow.
Your app will receive a short-lived "handoff token" from the Embassy
backend, exchange it with FMS for an access token, then use that access
token for every FMS API call.

---

## What you need from the FMS team

- The **Postman collection** (`FacilityManagement_Mobile.postman_collection.json`)
- The **FMS server URL**
  - Local dev: `http://localhost:4002`
  - Staging: `https://fms-staging.onmobilise.com`
  - Production: `https://fms.onmobilise.com`

## What you need from the Embassy team

- An **"Open FMS" button in the Embassy UI** that triggers the handoff
- The **Embassy backend endpoint** that mints the handoff token (e.g. `POST https://embassy.app/api/sso/fms-handoff`)
- A **test handoff token** (short-lived, for Postman verification)

You will **not** be given:
- The Embassy private key
- The FMS JWT secret
- The .env file contents

All signing/verification happens server-side. You just hit endpoints.

---

## 60-second test flow (Postman)

1. **Import** `FacilityManagement_Mobile.postman_collection.json` into Postman.
2. Open the collection → **Variables** tab and set:
   - `base_url` = the FMS server URL
   - `handoff_token` = a test token minted by Embassy (ask the Embassy team)
3. Open the folder **"8. Embassy SSO (preferred for mobile)"** and run these two in order:

   | Step | Request | What happens |
   |---|---|---|
   | 1 | Exchange handoff for FMS token | Trades the handoff token for an FMS access token, auto-saves to `{{token}}` |
   | 2 | Verify auth via /api/demo | Returns the authenticated user — proof the token works |

4. Any other request in the collection (facilities, bookings, etc.) now
   authenticates automatically using the saved `{{token}}`.

If step 1 returns `401 "User is not provisioned in FMS"`, the email in the
handoff token doesn't exist in the FMS users table — the FMS admin needs
to create a matching user first.

---

## Flow (what's actually happening)

```
User (already logged into Embassy app)
   │
   │ Clicks "Open FMS" button
   ▼
Embassy frontend
   │
   │ POST https://embassy.app/api/sso/fms-handoff
   │ (Embassy session cookie attached)
   ▼
Embassy backend
   │
   │ Verifies the Embassy session
   │ Signs an RS256 JWT with Embassy's private key
   │ Payload: { email, sub, name, iss: 'embassy', aud: 'fms', exp, iat }
   │
   │ Response: { handoff_token: "eyJ..." }
   ▼
Embassy / mobile frontend
   │
   │ POST https://fms.onmobilise.com/api/auth/sso/embassy
   │ Body: { handoff_token: "eyJ..." }
   ▼
FMS backend
   │
   │ Verifies with Embassy public key
   │ Verifies iss=embassy, aud=fms, exp, replay
   │ Extracts `email` from the verified payload
   │ Looks up user: SELECT * FROM users WHERE email = ?
   │ If not found → 401
   │ If found → mints FMS access token (12h)
   │
   │ Response: { token, user }
   ▼
Mobile app
   │
   │ Stores access token in SECURE storage
   │ (iOS Keychain / Android Keystore / expo-secure-store)
   │
   │ GET /api/facilities, POST /api/bookings, etc.
   │ Authorization: Bearer <access_token>
   ▼
FMS backend
   │
   │ Normal auth middleware validates the access token
   │ User authenticated → proceed
```

---

## Suggested mobile code structure

```javascript
// sso.ts  (pseudocode — adapt to React Native / native)

const EMBASSY_BASE   = 'https://embassy.app';
const FMS_BASE       = 'https://fms.onmobilise.com';

// --- Step 1: get a handoff token from Embassy -----------------------------
async function getHandoffToken() {
  const r = await fetch(`${EMBASSY_BASE}/api/sso/fms-handoff`, {
    method: 'POST',
    credentials: 'include',   // sends Embassy session cookie
  });
  const json = await r.json();
  if (!json.handoff_token) throw new Error('No handoff token returned');
  return json.handoff_token;
}

// --- Step 2: exchange it with FMS for an access token --------------------
async function exchangeForFmsToken(handoffToken) {
  const r = await fetch(`${FMS_BASE}/api/auth/sso/embassy`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ handoff_token: handoffToken }),
  });
  const json = await r.json();
  if (!json.status) throw new Error(json.msg);
  return { accessToken: json.data.token, user: json.data.user };
}

// --- Step 3: store securely + use for API calls --------------------------
async function loginToFms() {
  const handoff = await getHandoffToken();
  const { accessToken, user } = await exchangeForFmsToken(handoff);
  await SecureStore.setItem('fms_access_token', accessToken);
  await SecureStore.setItem('fms_user', JSON.stringify(user));
  return user;
}

// --- API client that auto-attaches the token -----------------------------
async function fmsApi(path, opts = {}) {
  const token = await SecureStore.getItem('fms_access_token');
  const r = await fetch(`${FMS_BASE}${path}`, {
    ...opts,
    headers: {
      ...(opts.headers || {}),
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });
  if (r.status === 401) {
    // Token expired or invalid — kick off re-login
    throw new UnauthenticatedError();
  }
  return r.json();
}

// Usage:
const facilities = await fmsApi('/api/facilities?limit=50');
```

### Storage choice
- **iOS**: Keychain Services (via `expo-secure-store` or `react-native-keychain`)
- **Android**: Keystore + EncryptedSharedPreferences
- **Never** use plain `AsyncStorage` for the access token — it's unencrypted.

### Token lifetime
- FMS access token: **12 hours**
- When it expires → re-run the SSO flow (new handoff → exchange)
- No refresh-token mechanism yet — add later if session UX requires it

---

## Error responses to handle

| HTTP | `msg` | What it means | What mobile should do |
|---|---|---|---|
| 400 | `Handoff token is missing the required "email" claim` | Embassy didn't include email in payload | Flag to Embassy team |
| 401 | `Invalid handoff token: ...` | Signature failed | Keys mismatch — contact FMS team |
| 401 | `Handoff token has expired` | Token > 60s old | Mint a fresh one |
| 401 | `Handoff token already used (replay rejected)` | Already exchanged | Mint a fresh one |
| 401 | `User is not provisioned in FMS. Please contact your administrator.` | Email not in FMS DB | Ask FMS admin to create the user |
| 403 | `Account is inactive or not approved` | User exists but is disabled | Ask admin to activate |
| 403 | `This tenant account is inactive. Contact your administrator.` | Tenant disabled | Ask admin |
| 404 | `Embassy SSO is not enabled on this server.` | `EMBASSY_SSO_ENABLED=false` | Ask FMS team to enable |
| 429 | `Too many SSO attempts. Please try again later.` | Rate limit hit (30 / 15 min / IP) | Back off |

---

## FAQ

**Q: Do I need the private key or any secret?**
No. All signing happens server-side. You only ever hit HTTP endpoints.

**Q: What if the FMS access token expires mid-session?**
Call the SSO flow again (new handoff → exchange). The mobile app should
transparently re-authenticate on a 401 response.

**Q: How do I test without the Embassy backend running?**
Ask the Embassy team to provide a test handoff token (short-lived, ~60s).
Paste it into Postman's `handoff_token` variable and run "Exchange handoff
for FMS token".

**Q: What if my test user's role is wrong?**
Role comes from the FMS DB. Ask the FMS admin to update the user's role —
the handoff token doesn't carry role info authoritatively.

**Q: How do I log the user out?**
Delete the access token from secure storage. The server-side token stays
valid until its 12h expiry (there's no server-side blocklist yet). For a
hard logout, the user also needs to log out of Embassy, or clear app data.

---

## Contacts

- FMS backend / API issues: _(fill me in)_
- Embassy integration / token payload questions: _(fill me in)_
- Mobile integration questions: _(fill me in)_
