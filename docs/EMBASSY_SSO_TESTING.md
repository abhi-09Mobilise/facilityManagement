# Embassy SSO Handoff — Local Testing Guide

The FMS backend accepts a short-lived JWT minted by the Embassy app and
exchanges it for a normal FMS JWT. During development you don't need the
Embassy app running — a small minter script simulates it using a local
RSA keypair.

## Flow

```
┌──────────────────┐    1. mint handoff JWT    ┌──────────────────┐
│  Embassy app     │ ───────────────────────▶  │  Embassy user    │
│  (OR local       │   RS256, 60s TTL,         │  (clicks button) │
│  minter script)  │   signed with private key │                  │
└──────────────────┘                           └────────┬─────────┘
                                                        │
                           2. POST /api/auth/sso/embassy│
                              { handoff_token: "..." }  ▼
                                            ┌───────────────────────┐
                                            │  FMS backend          │
                                            │  - verify signature   │
                                            │    (public key)       │
                                            │  - check exp/iss/aud  │
                                            │  - replay-check jti   │
                                            │  - find user by       │
                                            │    external_id        │
                                            │  - mint FMS JWT       │
                                            └──────────┬────────────┘
                                                       │
                           3. { token, user }          ▼
                                            ┌───────────────────────┐
                                            │  Client stores token  │
                                            │  for subsequent calls │
                                            └───────────────────────┘
```

## One-time setup

### 1. Run the migration

```
cd backend
# via your usual migration runner, e.g.:
node scripts/run-migrations.js
```

This adds `users.external_id` (unique when set, nullable).

### 2. Generate the test keypair

```
cd backend
node scripts/gen-embassy-keypair.js
```

Writes to `backend/certs/` (gitignored):
- `embassy_test_private.pem` — used by the minter script only
- `embassy_test_public.pem`  — loaded by FMS to verify tokens

### 3. Enable Embassy SSO in `.env`

```
EMBASSY_SSO_ENABLED=true
EMBASSY_PUBLIC_KEY_PATH=./certs/embassy_test_public.pem
EMBASSY_ISSUER=embassy
EMBASSY_AUDIENCE=fms
EMBASSY_CLOCK_TOLERANCE_SEC=60
EMBASSY_PRIVATE_KEY_PATH_FOR_TESTING=./certs/embassy_test_private.pem
```

### 4. Link a test user

Pick any existing FMS user (or create one) and set its `external_id` to
the identifier the Embassy app will send. For local testing the id is
arbitrary — use the FMS user id itself to keep it simple.

```sql
UPDATE users SET external_id = '42' WHERE id = 42;
```

### 5. Restart the backend

```
npm start
```

## Per-test cycle

### 1. Mint a handoff token

```
node backend/scripts/mint-test-handoff.js --user-id 42
```

Pass whatever you set as `external_id` in step 4. The script prints both
the raw token and a ready-to-paste Postman body.

Options:
- `--tenant-id 5`       — add tenant_id claim (optional; FMS validates match)
- `--email you@foo.com` — override the email claim (cosmetic only)
- `--ttl 300`           — token lifetime in seconds (default 60)

### 2. Exchange it for an FMS JWT

```
POST http://localhost:4002/api/auth/sso/embassy
Content-Type: application/json

{
  "handoff_token": "eyJhbGciOi..."
}
```

Response:

```json
{
  "status": true,
  "msg": "Embassy SSO login successful",
  "data": {
    "token": "eyJhbGci...",
    "user": { "id": 42, "name": "...", "role": "...", ... }
  }
}
```

### 3. Call `/api/demo` with the FMS JWT

```
GET http://localhost:4002/api/demo
Authorization: Bearer <fms_jwt_from_step_2>
```

Response:

```json
{
  "status": true,
  "msg": "Embassy SSO round-trip successful. You are authenticated as this FMS user:",
  "data": {
    "authenticated_as": { "id": 42, "name": "...", "role": "...", "tenant_id": 5, ... },
    "server_time": "2026-10-22T13:00:00.000Z"
  }
}
```

The FMS JWT is a normal FMS session token — any other `/api/*` endpoint
accepts it too.

## Expected error cases

Try these to confirm the guard rails:

| Scenario | How to trigger | Expected response |
|---|---|---|
| Expired token | Wait > 60s before exchange | `401 Handoff token has expired` |
| Replay | Exchange same token twice | `401 Handoff token already used (replay rejected)` |
| Unknown user | `--user-id 99999` (no FMS row) | `401 User is not provisioned in FMS` |
| Tenant mismatch | `--tenant-id 999` (wrong tenant) | `403 Tenant mismatch between handoff token and FMS user record` |
| Disabled SSO | Set `EMBASSY_SSO_ENABLED=false`, restart | `404 Embassy SSO is not enabled on this server` |
| Tampered token | Flip a character in the JWT | `401 Invalid handoff token: ...` |

## Rolling to production

Only two things change:

1. Point `EMBASSY_PUBLIC_KEY_PATH` at the real Embassy app's public key file.
2. Delete `EMBASSY_PRIVATE_KEY_PATH_FOR_TESTING` from the prod `.env` (and
   never ship `backend/scripts/mint-test-handoff.js` to a prod box — it is
   dev-only).

The route itself, the controller, the middleware, the DB schema, and the
Embassy team's token payload shape stay identical.

## Replay prevention — production note

The current `isReplay()` cache lives in-process memory (a Map that is
periodically culled). That is sufficient for a single-instance test
environment. For a multi-instance production deployment, swap the two
helpers in `backend/src/modules/auth/sso.controller.js` for a Redis
`SETNX` with TTL = token expiry, or a `sso_jti_seen (jti PRIMARY KEY,
expires_at)` table. The controller's calling code doesn't change.
