# VSCode Chat Copy — Troubleshooting Steps

Copy nahi ho raha chat panel se? Try in order. Jab bhi copy work kare, ruk jaao.

---

## 1. Reload window (first try — fixes 95% cases)

```
Ctrl + Shift + P
```

Type: `Reload Window`

Press Enter.

VSCode reload hoga 2-3 seconds me. Phir chat me text select karke `Ctrl + C` try karo.

---

## 2. Close + reopen Claude Code panel

- Sidebar me Claude Code icon pe click karke panel close karo
- Dubara click karke open karo
- Chat pe click karke focus laao
- Text select karo → `Ctrl + C`

---

## 3. Right-click → Copy

Chat text pe right-click karo. Context menu me "Copy" option dikhega.
Click karo → done.

---

## 4. Restart Claude Code extension

```
Ctrl + Shift + P
```

Type: `Developer: Restart Extension Host`

Press Enter. Extension restart hoga. Phir try karo copy.

---

## 5. Last resort — VSCode fully close + reopen

- VSCode window ka X button se close karo poora
- Dubara VSCode kholo
- Project folder kholo
- Claude Code panel open karo
- Try copy

---

## Pending decision (revert)

Bata do (a) ya (b) — fir main revert start karu:

- **(a)** Sab 5 items revert karu (email change bhi)
- **(b)** Email change rakhu, sirf dev-mint endpoint + Postman + README revert karu

Mera suggestion: **(b)** — kyunki email lookup FMS team ki checklist me hai, future me zarurat padegi.
