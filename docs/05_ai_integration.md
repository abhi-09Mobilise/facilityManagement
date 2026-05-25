# 05 — AI integration (description writing + chatbot booking)

**Goal.** (a) "Improve description" button in FacilityFormPage. (b) Chat widget for employees to book by saying *"book swim_092 tomorrow 7–8am for 3 people"*.

## Current state
No AI surface. No model API key in env yet. (Recommend Anthropic Claude.)

## Architecture

```
Frontend chat widget ──► POST /ai/chat ──► backend orchestrator
                                                   │
                                                   ├─► Claude API (tool use)
                                                   │     │
                                                   │     └─ tools: search_facilities,
                                                   │              check_availability,
                                                   │              create_booking
                                                   │
                                                   └─► returns next message or
                                                       booking-confirmation card
```

## Schema delta

```sql
-- 026_ai_chat.sql
CREATE TABLE ai_chat_sessions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  tenant_id INT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_user (user_id)
);
CREATE TABLE ai_chat_messages (
  id INT AUTO_INCREMENT PRIMARY KEY,
  session_id INT NOT NULL,
  role ENUM('user','assistant','tool') NOT NULL,
  content MEDIUMTEXT NOT NULL,
  tool_name VARCHAR(64),
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_acm_s FOREIGN KEY (session_id) REFERENCES ai_chat_sessions(id) ON DELETE CASCADE
);
```

## API
- `POST /ai/chat` — `{ session_id?, message }` → `{ session_id, reply, action? }`.
- `POST /ai/describe-facility` — `{ name, type, capacity }` → `{ description }` (super_admin / tenant_admin only).

## Tool functions exposed to the model
Thin wrappers over existing controllers — **reuse the same authorization**. Tool calls execute as `req.user`.

## UI
- FacilityFormPage: "✨ Generate" button next to the Description textarea.
- Bottom-right floating chat bubble across the app for employees. shadcn `Dialog` opens on click.

```
┌─ AI Assistant ────────────────────────────┐
│  You: book the pool tmrw 7am for 1 hr     │
│  ⌁: Found Olympic Pool — Mon 7:00–8:00.   │
│      6 of 25 seats taken. Confirm?        │
│      [Yes, book it]  [Change]             │
└───────────────────────────────────────────┘
```

## UX copy
- Disambiguation: *"There are two pools — Olympic Pool (Mumbai HQ) and Splash Pool (Pune). Which one?"*
- Capacity hit: *"That slot is full. Want me to find the next available time?"*

## Effort & risks
**L.** Risks: cost / rate-limits (cap conversations to 20 turns); always require explicit confirm before `create_booking`.
