<div align="center">

# ⚡ Discord Auto Bump

Automate Discord bumps across multiple accounts with a simple, configurable loop. Edge-first browser selection, persistent sessions, and helpful logs.

</div>

---

## Features

- Multi-account rotation with a single, clear delay (e.g., 1 hour)
- Separate persisted session per account (`sessionName`)
- Detects existing session to avoid unnecessary logins
- Sends 2 consecutive `/bump` messages each pass
- Optional “24h security” automation (panel + save) with:
  - Webhook notification (embed)
  - Confirmation message in the channel when applied
- Clean, timestamped logs (minimal and colored modes available)
- Edge preferred on all platforms (fallback to Chrome or Puppeteer’s bundled browser)

> Disclaimer: Automation might violate the TOS of Discord or target bots. Use at your own risk.

---

## Quick start

```powershell
npm install
npm start
```

Node 18+ recommended. On Windows, running from PowerShell is preferred.

---

## Configuration

Use `config.json` (see `config.example.json`):

```json
{
  "logging": { "minimal": false, "colored": false },
  "loop": { "enabled": true, "delayMs": 3600000, "maxCycles": null },
  "messages": { "securityActivated": { "text": "Security 24h enabled ✅" } },
  "accounts": [
    {
      "email": "user1@example.com",
      "password": "pass1",
      "sessionName": "account-A",
      "channelUrl": "https://discord.com/channels/<guild>/<channel>",
      "webhookUrl": "https://discord.com/api/webhooks/...",
      "enableSecurityAction": true
    },
    {
      "email": "user2@example.com",
      "password": "pass2",
      "sessionName": "account-B",
      "channelUrl": "https://discord.com/channels/<guild>/<channel>",
      "webhookUrl": "https://discord.com/api/webhooks/...",
      "enableSecurityAction": true
    }
  ]
}
```

- `loop.delayMs`: single delay between each account’s pass (e.g., `3600000` = 1 hour; for tests use `8000`).
- `messages.securityActivated.text`: message posted in the channel when the 24h security is confirmed.

---

## How it runs

```text
for (cycle = 1..∞) {
  for (account of accounts) {
    runAccount(account);
    wait(delayMs);
  }
}
```

Each pass:
1) Launches the browser with the account’s profile
2) Detects if an existing session is active (otherwise performs a simple login)
3) Navigates to the channel and sends `/bump` twice
4) Applies/Confirms “24h security” if enabled (webhook + channel message)
5) Closes the browser (by default)

---

## Customization

- Logs: `logging.minimal`, `logging.colored`
- Confirmation message: `messages.securityActivated.text`
- Number of cycles: `loop.maxCycles` (e.g., `5`), or `null` to run indefinitely
- Add more accounts by extending the `accounts` array

---

## Browser selection (Edge preferred)

This project uses Puppeteer and will attempt to launch Microsoft Edge first on all platforms. If Edge is not found, it falls back to Chrome or Puppeteer’s bundled browser.

Override the browser via environment variable if needed:

```powershell
$env:PUPPETEER_EXECUTABLE_PATH = "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe"; npm start
```

Linux/macOS examples:

```bash
export PUPPETEER_EXECUTABLE_PATH="/usr/bin/microsoft-edge"; npm start
# or
export PUPPETEER_EXECUTABLE_PATH="/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"; npm start
```

On Linux/WSL without a display server (`DISPLAY`), the script defaults to headless mode (`headless: "new"`).

---

## Troubleshooting

- Nothing is posted in the channel: ensure the message input has focus.
- Login loop: delete the folder `sessions/<sessionName>` for that account and restart.
- Discord selectors changed: update the selectors for the input/buttons in the code.
- Check startup logs: session list, loop status, and delay printed.

### Puppeteer: Failed to launch the browser process

If you see errors like:

```
Error: Failed to launch the browser process!
.../chrome-linux64/chrome: 1: Syntax error: "(" unexpected
```

Causes and fixes:

- WSL/Linux without a compatible binary: the downloaded Chromium cannot run in the current environment. The script automatically tries:
  - `PUPPETEER_EXECUTABLE_PATH` if set,
  - a locally installed Edge (preferred) or Chrome,
  - otherwise Puppeteer’s bundled browser.

- Useful env vars:
  - `PUPPETEER_EXECUTABLE_PATH`: full path to msedge/chrome/chromium.
  - `PUPPETEER_CACHE_DIR`: custom Puppeteer cache directory.

- On Linux/WSL without X server (`DISPLAY`), headless mode is used by default. To see UI, run with a display or set `headless: false` in `config.json` per account.

- Windows: ensure Microsoft Edge or Google Chrome is installed. The script searches common locations under Program Files/LocalAppData.

PowerShell example to force a path:

```powershell
$env:PUPPETEER_EXECUTABLE_PATH = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"; npm start
```

---

## License

Personal use only. No warranty.

