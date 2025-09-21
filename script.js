// Load config.json (supports comments)
async function loadConfig() {
  const raw = await fs.readFile(path.join(process.cwd(), 'config.json'), 'utf-8');
  // Strip comments (// or # at line start, and /* ... */ blocks)
  const noBlockComments = raw.replace(/\/\*[\s\S]*?\*\//g, '');
  const noLineComments = noBlockComments.replace(/^\s*(#|\/\/).*$/gm, '');
  return JSON.parse(noLineComments);
}
import puppeteer from 'puppeteer';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import readline from 'readline';

// Inline progress UI (module-scope so all functions can use it)
let UI = { inlineProgress: true, spinner: true };
const isTTY = !!process.stdout.isTTY;
const spinnerFrames = process.platform === 'win32'
  ? ['|','/','-','\\']
  : ['⠋','⠙','⠹','⠸','⠼','⠴','⠦','⠧','⠇','⠏'];
let spinnerIdx = 0;
function nextSpinner() {
  const f = spinnerFrames[spinnerIdx % spinnerFrames.length];
  spinnerIdx = (spinnerIdx + 1) % spinnerFrames.length;
  return f;
}
function writeInline(text) {
  if (!(UI.inlineProgress && isTTY)) return;
  readline.clearLine(process.stdout, 0);
  readline.cursorTo(process.stdout, 0);
  process.stdout.write(text);
}
function endInline() {
  if (!(UI.inlineProgress && isTTY)) return;
  process.stdout.write('\n');
}

// Simplified flow: sequential login + sending /bump
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let LOG_MINIMAL = false;
let LOG_COLORED = false;
const ESSENTIAL_PATTERNS = [
  /Opening browser/,
  /Initial access to login page/,
  /Two bumps sent|Second bump sent/,
  /Security 24h enabled|24h confirmed/,
  /Error:/,
  /Browser closed/,
  /Start of cycle/,
  /All accounts processed/,
  /\[Security\] 24h confirmed/,
];
// Icons and symbols for display
const ICONS = {
  success: '✓',
  error: '✗',
  warning: '⚠️',
  info: 'ℹ️',
  security: '🔒',
  browser: '🌐',
  bump: '⚡',
  cycle: '🔄',
  time: '⏱️',
  user: '👤',
  arrow: '➤',
  bullet: '•',
  loading: '⟳',
  connected: '🔗',
  progress: '▶️'
};

const COLORS = { 
  reset: '\x1b[0m', 
  bold: '\x1b[1m', 
  dim: '\x1b[2m',
  underline: '\x1b[4m',
  // Couleurs de base
  red: '\x1b[31m', 
  green: '\x1b[32m', 
  yellow: '\x1b[33m', 
  blue: '\x1b[34m', 
  magenta: '\x1b[35m', 
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  gray: '\x1b[90m',
  // Couleurs vives
  brightRed: '\x1b[91m',
  brightGreen: '\x1b[92m',
  brightYellow: '\x1b[93m',
  brightBlue: '\x1b[94m',
  brightMagenta: '\x1b[95m',
  brightCyan: '\x1b[96m',
  brightWhite: '\x1b[97m'
};
function colorFor(msg){
  if (/Error/i.test(msg)) return COLORS.brightRed + COLORS.bold;
  if (/Security.*confirmed|Security 24h enabled/.test(msg)) return COLORS.brightGreen + COLORS.bold;
  if (/Two bumps sent|Second bump sent|First bump sent/.test(msg)) return COLORS.brightCyan + COLORS.bold;
  if (/Opening browser|Initial access/.test(msg)) return COLORS.brightBlue;
  if (/Browser closed/.test(msg)) return COLORS.magenta;
  if (/Start of cycle|cycle/.test(msg)) return COLORS.brightYellow + COLORS.bold;
  if (/(Signed in|session active)/.test(msg)) return COLORS.brightGreen;
  if (/(Observation|Waiting|Progress)/.test(msg)) return COLORS.gray;
  if (/\[Security\]/.test(msg)) return COLORS.cyan;
  return COLORS.reset;
}

function getIcon(msg) {
  if (/Erreur|error/i.test(msg)) return ICONS.error;
  if (/Security.*confirmed|Security 24h enabled/.test(msg)) return ICONS.security;
  if (/(bump sent|Two bumps sent)/i.test(msg)) return ICONS.bump;
  if (/Opening browser/.test(msg)) return ICONS.browser;
  if (/Browser closed/.test(msg)) return ICONS.success;
  if (/cycle/.test(msg)) return ICONS.cycle;
  if (/(Signed in|session active)/.test(msg)) return ICONS.connected;
  if (/(Observation|Waiting|Progress)/.test(msg)) return ICONS.loading;
  if (/\[Security\]/.test(msg)) return ICONS.security;
  if (/(Launching|Start)/.test(msg)) return ICONS.progress;
  return ICONS.bullet;
}

function log(msg) {
  if (LOG_MINIMAL) {
    const keep = ESSENTIAL_PATTERNS.some(r => r.test(msg));
    if (!keep) return;
  }
  const timestamp = new Date().toLocaleTimeString('en-US');
  const icon = getIcon(msg);
  if (LOG_COLORED) {
    const color = colorFor(msg);
    console.log(`${COLORS.dim}[${timestamp}]${COLORS.reset} ${color}${icon} ${msg}${COLORS.reset}`);
  } else {
    console.log(`[${timestamp}] ${icon} ${msg}`);
  }
}
// (bloc intrus supprimé)

// Simple login: fill email/password when available, otherwise wait for manual login
async function simpleLogin(page, cfg, opts = {}) {
  const email = cfg.email || cfg.login || null;
  const password = cfg.password || null;
  const d = cfg.simpleDelays || {};
  const waitFormMs = d.waitFormMs ?? 30000;
  const afterTypeMs = d.afterTypeMs ?? 300;
  const submitWaitMs = d.submitWaitMs ?? 700;
  const maxWaitMs = d.maxWaitMs ?? 120000;

  try { await page.waitForSelector('form', { timeout: waitFormMs }); } catch {}

  if (email && password) {
    try {
      const emailSel = 'input[name="email"], input[type="email"]';
      const passSel = 'input[name="password"][type="password"], input[type="password"]';
      await page.waitForSelector(emailSel, { timeout: 15000 });
      await page.type(emailSel, email, { delay: 50 });
      await sleep(afterTypeMs);
      await page.waitForSelector(passSel, { timeout: 15000 });
      await page.type(passSel, password, { delay: 50 });
      await sleep(afterTypeMs);
      const btn = await page.$('button[type="submit"]');
      if (btn) { await btn.click(); await sleep(submitWaitMs); }
      log('Login attempt submitted');
    } catch (e) {
      log('Could not auto-fill credentials; continue manually.');
    }
  } else {
    log('Credentials not provided; sign in manually if required.');
  }

  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    try {
      const connected = await page.evaluate(() => {
        return !!(document.querySelector('#app-mount [class*="sidebar"], #app-mount nav'));
      });
      if (connected) { log(`${ICONS.connected} Signed in.`); return true; }
    } catch {}
    await sleep(2000);
  }
  throw new Error('Login timeout');
}

async function simpleBump(page, cfg) {
  const channelUrl = cfg.channelUrl || 'https://discord.com/channels/1150371679520968804/1300408274184830979';
  log('Navigate to bump channel');
  await page.goto(channelUrl, { waitUntil: 'domcontentloaded' });
  const d = cfg.bumpDelays || {};
  const afterChannel = d.afterChannelMs ?? (cfg.simpleDelays?.afterChannelMs ?? 5000);
  await sleep(afterChannel);

  // Optional security step
  if (cfg.enableSecurityAction !== false) {
    await configureSecurityActions24hInline(page, cfg);
  }

  // Bumps
  const betweenKeys = d.betweenKeysMs ?? 600;
  const afterFirstBump = d.afterFirstBumpMs ?? 1800;
  const afterSecondBump = d.afterSecondBumpMs ?? 1200;
  const inputSelector = 'div[data-slate-node="element"]';
  await page.waitForSelector(inputSelector, { timeout: 30000 });
  await page.click(inputSelector);
  await sleep(400);
  // First bump
  await page.keyboard.type('/bump', { delay: 85 });
  await sleep(betweenKeys);
  await page.keyboard.press('Enter');
  await sleep(500);
  await page.keyboard.press('Enter');
  log(`${ICONS.bump} First bump sent`);
  await sleep(afterFirstBump);
  // Second bump
  await page.keyboard.type('/bump', { delay: 85 });
  await sleep(betweenKeys);
  await page.keyboard.press('ArrowDown');
  await sleep(400);
  await page.keyboard.press('Enter');
  await sleep(500);
  await page.keyboard.press('Enter');
  log(`${ICONS.bump} Second bump sent`);
  if (cfg.webhookUrl) {
    const sessionLabel = cfg.sessionName || 'session';
    const cycle = cfg.__currentCycle;
    const meta = { session: sessionLabel, channel: cfg.channelUrl || 'unknown' };
    if (cycle !== undefined) meta.cycle = cycle;
    await postWebhook(cfg.webhookUrl, { event: 'bumps-complete', message: 'Two bumps sent', _meta: meta });
  }
  await sleep(afterSecondBump);
}

// Configure 24h security directly within the bump flow
async function configureSecurityActions24hInline(page, cfg) {
  const d = cfg.securityDelays || {};
  const preClick = d.preClickButtonMs ?? 800;
  const afterButton = d.afterClickButtonMs ?? 1600;
  const afterSelectOpen = d.afterSelectOpenMs ?? 1000;
  const afterOption = d.afterOptionClickMs ?? 1200;
  const afterSave = d.afterSaveMs ?? 1600; // post-selection wait
  const waitSaveButtonMs = d.waitSaveButtonMs ?? 6000; // max time to find the Save button
  const savePollIntervalMs = d.savePollIntervalMs ?? 400; // polling interval
  const confirmWaitMs = d.confirmWaitMs ?? 7000; // max time to see 24h applied
  const confirmPollIntervalMs = d.confirmPollIntervalMs ?? 500;
  const securityDebugOnFail = !!d.securityDebugOnFail;
  const buttonSelector = 'button.button__6e2b9.actionButton__36c3e';
  const selectWrapper = 'div.wrapper__3412a.select__3f413';
  const valueSelector = 'div.value__3f413';
  const option24Selector = 'div.option__3f413';

  try { await page.waitForSelector(buttonSelector, { timeout: 10000 }); } catch { log('[Security] Button not found -> skipping'); return; }
  log('[Security] Button detected');
  await sleep(preClick);

  // Already configured?
  try {
    const already = await page.evaluate(sel => {
      const val = document.querySelector(sel);
      if (!val) return false;
      const txt = (val.textContent||'').toLowerCase();
      return txt.includes('24');
    }, valueSelector);
    if (already) { log('[Security] Already set to 24h -> skip'); if (cfg.webhookUrl) await postWebhook(cfg.webhookUrl, { event: 'security-skip', message: 'Already 24h' }); return; }
  } catch { log('[Security] Could not read initial state'); }

  try { await page.click(buttonSelector); log('[Security] Panel opened (button click)'); } catch { log('[Security] Failed to click button'); return; }
  await sleep(afterButton);

  // Open dropdown
  try { await page.click(selectWrapper); log('[Security] Dropdown opened'); } catch { try { await page.click(valueSelector); log('[Security] Opened via value'); } catch { log('[Security] Could not open dropdown'); } }
  await sleep(afterSelectOpen);

  // Click exact 24h option
  let picked = false;
  try {
    picked = await page.evaluate(optSel => {
      const opts = Array.from(document.querySelectorAll(optSel));
      const target = opts.find(o => /24/.test((o.textContent||'')));
      if (target) { target.dispatchEvent(new MouseEvent('click', { bubbles:true })); return true; }
      return false;
    }, option24Selector);
  } catch { }
  log(picked ? '[Security] 24h option selected' : '[Security] 24h option NOT found');
  await sleep(afterOption);

  // Find and click the Save button (text-based polling, class-agnostic)
  // Strategy: poll until waitSaveButtonMs and try multiple click modes.
  let saveClicked = false;
  let saveFound = false;
  const tStart = Date.now();
  while (Date.now() - tStart < waitSaveButtonMs && !saveClicked) {
    try {
      const res = await page.evaluate(() => {
        function byText(root, textRegex) {
          const all = Array.from(root.querySelectorAll('button, [role="button"], span'));
            return all.find(el => textRegex.test((el.textContent||'').trim()));
        }
        const needle = /save|sauvegarder/i;
        const candidate = byText(document, needle);
        if (!candidate) return { found: false, clicked: false };
        // Si c'est un span on remonte vers parent button/role=button
        let clickable = candidate;
        let depth = 0;
        while (depth < 6 && clickable && !(['BUTTON'].includes(clickable.tagName) || clickable.getAttribute('role') === 'button')) {
          clickable = clickable.parentElement;
          depth++;
        }
        if (!clickable) return { found: true, clicked: false };
        clickable.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        return { found: true, clicked: true };
      });
      if (res.found) saveFound = true;
      if (res.clicked) {
        saveClicked = true;
        break;
      }
    } catch {}
    if (!saveClicked) await sleep(savePollIntervalMs);
  }
  if (saveClicked) {
    log('[Security] Save button clicked');
  } else if (saveFound) {
    log('[Security] Save button found but click may be blocked/ineffective');
  } else {
    log('[Security] Save button not found (timeout)');
  }
  await sleep(afterSave);

  // Final confirmation with polling
  let confirmed = false;
  const tConfStart = Date.now();
  while (Date.now() - tConfStart < confirmWaitMs && !confirmed) {
    try {
      confirmed = await page.evaluate(sel => {
        const val = document.querySelector(sel);
        if (!val) return false;
        const txt = (val.textContent||'').toLowerCase();
        // Accept texts containing 24
        return /24/.test(txt);
      }, valueSelector);
    } catch {}
    if (!confirmed) await sleep(confirmPollIntervalMs);
  }
  if (confirmed) {
    log('[Security] 24h confirmed (final)');
  } else if (securityDebugOnFail) {
    log(`[Security] NOT confirmed 24h (debug)${saveClicked ? ' (despite Save click)' : ''}`);
  }
  if (!confirmed && securityDebugOnFail) {
    try {
      await page.screenshot({ path: `security-fail-${Date.now()}.png` });
      log('[Security] Debug screenshot captured');
    } catch {}
  }
  if (cfg.webhookUrl && confirmed) {
    const sessionLabel = cfg.sessionName || 'session';
    const cycle = cfg.__currentCycle;
    const meta = { session: sessionLabel, picked, saveClicked };
    if (cycle !== undefined) meta.cycle = cycle;
    await postWebhook(cfg.webhookUrl, { event: 'security-activated', message: 'Security 24h enabled', _meta: meta });
  }

  // Send a message in the channel to confirm the 24h activation
  if (confirmed) {
    const defaultMsg = 'Security 24h enabled ✅';
    const chatMsg = (cfg.messages && cfg.messages.securityActivated && cfg.messages.securityActivated.text) || defaultMsg;
    try {
      await sendChannelMessage(page, chatMsg, cfg);
      log('[Security] Confirmation message sent to channel');
    } catch (e) {
      log('[Security] Failed to send confirmation message to channel');
    }
  }
}

// Send a simple text message in the current channel
async function sendChannelMessage(page, text, cfg) {
  const inputSelector = 'div[data-slate-node="element"]';
  const d = cfg.bumpDelays || {};
  const betweenKeys = d.betweenKeysMs ?? 60;
  await page.waitForSelector(inputSelector, { timeout: 30000 });
  await page.click(inputSelector);
  await sleep(200);
  await page.keyboard.type(text, { delay: Math.min(betweenKeys, 120) });
  await sleep(200);
  await page.keyboard.press('Enter');
  await sleep(300);
}

async function postWebhook(url, payload) {
  const embedOnly = payload.embedOnly ?? true; // default to embed-only
  const globalEmbedOnly = typeof payload.embedOnly === 'undefined' ? true : payload.embedOnly;
  const event = payload.event || 'event';
  const message = payload.message || '';
  const account = payload.accountLabel || (payload._meta && (payload._meta.session || payload._meta.account)) || 'session';
  // Colors per event type
  const colorMap = {
    'bumps-complete': 0x2ecc71,
    'security-activated': 0x1abc9c,
    error: 0xe74c3c,
    default: 0x5865F2
  };
  const color = colorMap[event] || colorMap.default;
  if (embedOnly || globalEmbedOnly || (payload._meta && payload._meta.forceEmbed)) {
    try {
      const fields = [];
      if (payload._meta) {
        for (const [k,v] of Object.entries(payload._meta)) {
          if (['forceEmbed'].includes(k)) continue;
          fields.push({ name: k, value: (v===undefined||v===null)?'—':String(v), inline: true });
        }
      }
      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          embeds: [
            {
              title: event,
              description: message,
              color,
              fields: fields.length ? fields : undefined,
              timestamp: new Date().toISOString(),
              footer: { text: account }
            }
          ]
        })
      });
    } catch (e) {
      log('Webhook error (embed)');
    }
  } else {
    try {
      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: `[${event}] ${message}` })
      });
    } catch (e) {
      log('Webhook error (content)');
    }
  }
}

// Send embed (Discord) – backwards-compatible helper
async function postWebhookEmbed(url, { title, description, color = 5793266, fields = [], footer, timestamp = true }) {
  // Kept for retro-compatibility, forwards to postWebhook
  return postWebhook(url, { event: title || 'info', message: description || '', embedOnly: true, _meta: Object.fromEntries(fields.map(f => [f.name || 'field', f.value])) });
}

// Stabilize startup to let the browser/session load
async function stabilize(page, cfg) {
  const startup = cfg.startup || {};
  const stabilizationMs = startup.stabilizationMs ?? 30000;
  log(`Browser startup stabilization ${stabilizationMs}ms`);
  await sleep(stabilizationMs);
}

// Quick login-state detection: small window to see if URL leaves /login
async function detectLoggedQuick(page, timeoutMs = 2000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const u = page.url();
    let path;
    try { path = new URL(u).pathname; } catch { path = u; }
    if (!(/\/login(\b|$)/.test(path))) {
      log(`URL left /login -> session active (${path})`);
      return { logged: true };
    }
    await sleep(200);
  }
  return { logged: false };
}

// Handle the Discord "Choose an account" screen when it appears
// Strategy options (accountCfg.auth or cfg.auth):
// - chooseAccountStrategy: 'connect' (default) | 'add'
//   - 'connect': click the "Connexion" button for the first account card
//   - 'add': click "Ajouter un compte" to go to normal sign-in
// - chooseAccountTimeoutMs: how long to wait for the screen (default 8000)
async function handleChooseAccountIfPresent(page, accountCfg) {
  // Merge global auth (from runAccount) and account-specific auth
  const auth = { ...(accountCfg.__globalAuth || {}), ...(accountCfg.auth || {}) };
  // Default to 'auto': click "Ajouter un compte" if present, otherwise click first account "Connexion"
  const strategy = auth.chooseAccountStrategy || 'auto';
  const waitMs = auth.chooseAccountTimeoutMs ?? 8000;
  // Be resilient to hashed class names by using contains selectors
  const rootSelector = 'section[class*="chooseAccountAuthBox_"]';
  try {
    await page.waitForSelector(rootSelector, { timeout: waitMs });
  } catch { return; }
  log('[Auth] "Choose an account" screen detected');
  if (strategy === 'add' || strategy === 'auto') {
    // Click the small text button under the actions area (language-agnostic, class-based)
    const clicked = await page.evaluate(() => {
      const root = document.querySelector('section[class*="chooseAccountAuthBox_"]');
      const actionAreas = root ? Array.from(root.querySelectorAll('[class*="actions_"]')) : [];
      const candidates = [
        ...Array.from(document.querySelectorAll('button[class*="textButton_"], .textButton__7a01b, [data-mana-component="text-button"]'))
      ];
      for (const el of candidates) {
        const inActions = el.closest('[class*="actions_"]');
        if (inActions || (root && root.contains(el))) {
          el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
          return true;
        }
      }
      return false;
    });
    log(clicked ? '[Auth] Clicked "Ajouter un compte"' : '[Auth] Could not click "Ajouter un compte"');
    if (clicked || strategy === 'add') return;
  }
  // Default: click the "Connexion" button of the first account card
  const done = await page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll('[class*="accountCard_"]'));
    if (!cards.length) return false;
    const card = cards[0];
    // Buttons inside the card (first is often "Connexion")
    const buttons = Array.from(card.querySelectorAll('button, [role="button"]'));
    let connect = buttons.find(b => b && b.textContent && b.textContent.trim().length > 0) || buttons[0];
    if (!connect) connect = card.querySelector('button');
    if (connect) { connect.dispatchEvent(new MouseEvent('click', { bubbles:true })); return true; }
    return false;
  });
  log(done ? '[Auth] Clicked "Connexion" on account card' : '[Auth] Could not click "Connexion"');
}

// Lightweight, non-blocking choose-account handler used during observation
async function pokeChooseAccountIfVisible(page, accountCfg) {
  const auth = { ...(accountCfg.__globalAuth || {}), ...(accountCfg.auth || {}) };
  const strategy = auth.chooseAccountStrategy || 'auto';
  // Only act if we're on /login to avoid accidental clicks elsewhere
  const path = (() => { try { return new URL(page.url()).pathname; } catch { return page.url(); } })();
  if (!/\/login(\b|$)/.test(path)) return false;
  if (strategy === 'add' || strategy === 'auto') {
    const clicked = await page.evaluate(() => {
      const root = document.querySelector('section[class*="chooseAccountAuthBox_"]');
      if (!root) return false;
      const btn = root.querySelector('button[class*="textButton_"], .textButton__7a01b, [data-mana-component="text-button"]');
      if (btn) { btn.dispatchEvent(new MouseEvent('click', { bubbles: true })); return true; }
      return false;
    });
    if (clicked) log('[Auth] Poke: clicked "Ajouter un compte"');
    if (clicked || strategy === 'add') return clicked;
  }
  {
    const done = await page.evaluate(() => {
      const root = document.querySelector('section[class*="chooseAccountAuthBox_"]');
      if (!root) return false;
      const card = root.querySelector('[class*="accountCard_"]');
      if (!card) return false;
      const buttons = Array.from(card.querySelectorAll('button, [role="button"]'));
      const connect = buttons.find(b => b && b.textContent && b.textContent.trim().length > 0) || buttons[0];
      if (connect) { connect.dispatchEvent(new MouseEvent('click', { bubbles: true })); return true; }
      return false;
    });
    if (done) log('[Auth] Poke: clicked "Connexion" on account card');
    return done;
  }
}

(async () => {
  const cfg = await loadConfig();
  // Logging: nouveau schéma (cfg.logging) avec compat ancienne clé
  LOG_MINIMAL = !!(cfg.logging?.minimal ?? cfg.minimalLogs);
  LOG_COLORED = !!(cfg.logging?.colored ?? cfg.coloredLogs);
  // Configure UI inline/spinner from cfg (guard against TDZ by using globalThis)
  {
    const u = (globalThis.UI ||= { inlineProgress: true, spinner: true });
    u.inlineProgress = cfg.ui?.inlineProgress ?? true;
    u.spinner = cfg.ui?.spinner ?? true;
    try { UI.inlineProgress = u.inlineProgress; UI.spinner = u.spinner; } catch {}
  }
  // UI configuration is now applied to module-scope UI only (no redeclaration here)
  
  console.log(createSeparator('BUMP SCRIPT START', 'thick'));
  log(`${ICONS.progress} Script initialization`);
  console.log(createSeparator('', 'single'));

  // Display helpers
  function createSeparator(title = '', type = 'double') {
    const width = 60;
    let char = '=';
    let color = COLORS.brightBlue;
    
    switch (type) {
      case 'single': char = '-'; color = COLORS.gray; break;
      case 'double': char = '='; color = COLORS.brightBlue; break;
      case 'thick': char = '█'; color = COLORS.brightCyan; break;
      case 'cycle': char = '●'; color = COLORS.brightYellow; break;
    }
    
    if (title) {
      const padding = Math.max(0, (width - title.length - 4) / 2);
      const leftPad = char.repeat(Math.floor(padding));
      const rightPad = char.repeat(Math.ceil(padding));
      return `${color}${leftPad} ${title} ${rightPad}${COLORS.reset}`;
    } else {
      return `${color}${char.repeat(width)}${COLORS.reset}`;
    }
  }

  function formatDelay(ms) {
    if (ms < 1000) return ms + ' ms';
    const sec = Math.round(ms / 1000);
    if (sec < 60) return sec + ' s';
    const min = Math.floor(sec / 60);
    const rem = sec % 60;
    if (rem === 0) return `${min} min`;
    return `${min} min ${rem} s`;
  }

  // Inline progress utilities are defined at module scope; use them directly

  async function waitDelayWithProgress(totalMs, label = 'waiting') {
    if (totalMs <= 0) return; // nothing
    
    // Dynamic granularity
    let step;
    if (totalMs >= 15 * 60 * 1000) step = 5 * 60 * 1000; // 5 min
    else if (totalMs >= 5 * 60 * 1000) step = 60 * 1000; // 1 min
    else if (totalMs >= 60 * 1000) step = 30 * 1000; // 30 s
    else if (totalMs >= 30 * 1000) step = 10 * 1000; // 10 s
    else if (totalMs >= 10 * 1000) step = 5 * 1000; // 5 s
    else step = 1000; // 1 s
    
    let waited = 0;
    while (waited < totalMs) {
      const remaining = totalMs - waited;
      const slice = Math.min(step, remaining);
      await sleep(slice);
      waited += slice;
      
      if (totalMs >= 10 * 1000) { // avoid spam for very short waits
        const progress = Math.round((waited / totalMs) * 100);
        const progressBar = '█'.repeat(Math.floor(progress / 5)) + '░'.repeat(20 - Math.floor(progress / 5));
        const spin = UI.spinner ? ` ${nextSpinner()}` : '';
        if (UI.inlineProgress && isTTY) {
          writeInline(`${ICONS.time} Progress ${label}: ${formatDelay(waited)} / ${formatDelay(totalMs)} [${progressBar}] ${progress}%${spin}`);
        } else {
          log(`${ICONS.time} Progress ${label}: ${formatDelay(waited)} / ${formatDelay(totalMs)} [${progressBar}] ${progress}%`);
        }
      }
    }
    if (UI.inlineProgress && isTTY && totalMs >= 10 * 1000) endInline();
  }

  async function runAccount(accountCfg) {
    const sessionRoot = path.join(process.cwd(), 'sessions');
    try { await fs.mkdir(sessionRoot, { recursive: true }); } catch {}
    const sessionName = (accountCfg.sessionName || 'default-session').replace(/[^a-zA-Z0-9_-]/g, '_');
    const userDataDir = path.join(sessionRoot, sessionName);
    // Optional: reset session folder before launching (fresh profile)
    if (accountCfg.resetSessionOnStart || (typeof accountCfg.resetSessionOnStart === 'undefined' && cfg.auth?.resetSessionOnStart)) {
      try { await fs.rm(userDataDir, { recursive: true, force: true }); } catch {}
    }
    log(`[${sessionName}] Opening browser`);
    const extraArgs = [
      '--window-size=1200,900',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-session-crashed-bubble',
      '--disable-features=Translate,ExtensionsToolbarMenu',
      '--disable-infobars'
    ];

    // Cross-platform launch resolution: choose executablePath if needed and safe headless on Linux/WSL without display.
    function isWSL() {
      return process.platform === 'linux' && /microsoft/i.test(os.release());
    }

    async function fileExists(p) {
      try { await fs.access(p); return true; } catch { return false; }
    }

    async function findLocalChromeWindows() {
      const env = process.env;
      // Prefer Edge first, then Chrome
      const candidates = [
        // Edge stable/insiders
        path.join(env["PROGRAMFILES"] || 'C:\\Program Files', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
        path.join(env["PROGRAMFILES(X86)"] || 'C:\\Program Files (x86)', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
        env["LOCALAPPDATA"] ? path.join(env["LOCALAPPDATA"], 'Microsoft', 'Edge SxS', 'Application', 'msedge.exe') : null,
        // Chrome
        path.join(env["PROGRAMFILES"] || 'C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe'),
        path.join(env["PROGRAMFILES(X86)"] || 'C:\\Program Files (x86)', 'Google', 'Chrome', 'Application', 'chrome.exe'),
        env["LOCALAPPDATA"] ? path.join(env["LOCALAPPDATA"], 'Google', 'Chrome', 'Application', 'chrome.exe') : null
      ].filter(Boolean);
      for (const c of candidates) { if (await fileExists(c)) return c; }
      return null;
    }

    async function findLocalChromeLinux() {
      const candidates = [
        '/usr/bin/microsoft-edge',
        '/opt/microsoft/msedge/msedge',
        '/usr/bin/chromium-browser',
        '/usr/bin/chromium',
        '/usr/bin/google-chrome',
        '/usr/bin/google-chrome-stable'
      ];
      for (const c of candidates) { if (await fileExists(c)) return c; }
      return null;
    }

    async function findLocalChromeDarwin() {
      const candidates = [
        '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
      ];
      for (const c of candidates) { if (await fileExists(c)) return c; }
      return null;
    }

    async function resolveExecutablePath() {
      // Priority 1: explicit env
      const fromEnv = process.env.PUPPETEER_EXECUTABLE_PATH;
      if (fromEnv && await fileExists(fromEnv)) return fromEnv;

      // Priority 2: System installations (prefer Edge), per platform
      if (process.platform === 'win32') {
        const winBrowser = await findLocalChromeWindows();
        if (winBrowser) return winBrowser;
      } else if (process.platform === 'linux') {
        const linBrowser = await findLocalChromeLinux();
        if (linBrowser) return linBrowser;
      } else if (process.platform === 'darwin') {
        const macBrowser = await findLocalChromeDarwin();
        if (macBrowser) return macBrowser;
      }

      // Priority 3: Puppeteer's downloaded browser
      try {
        const p = typeof puppeteer.executablePath === 'function' ? puppeteer.executablePath() : null;
        if (p && await fileExists(p)) return p;
      } catch {}

      return null; // let Puppeteer decide/run default
    }

    const headlessMode = (() => {
      if (typeof accountCfg.headless !== 'undefined') return accountCfg.headless;
      if (process.platform === 'linux' || isWSL()) {
        // In Linux/WSL, default to headless if no GUI/display; Puppeteer v22 supports 'new'
        return process.env.DISPLAY ? false : 'new';
      }
      return false;
    })();

    const execPath = await resolveExecutablePath();
    const launchOptions = { headless: headlessMode, defaultViewport: null, userDataDir, args: extraArgs };
    if (execPath) launchOptions.executablePath = execPath;

  const browser = await puppeteer.launch(launchOptions);
    // Réutiliser la première page si elle existe (évite about:blank supplémentaire)
    let pages = await browser.pages();
    let page = pages[0];
    if (!page) {
      page = await browser.newPage();
    }
    // Nettoyer pages about:blank supplémentaires (optionnel)
    const cleanup = accountCfg.cleanupBlankPages !== false; // défaut true
    if (cleanup) {
      for (const p of pages.slice(1)) {
        try { if ((p.url() || '').startsWith('about:blank')) await p.close(); } catch {}
      }
    }
    try {
      log(`${ICONS.browser} [${sessionName}] Initial access to login page`);
      await page.goto('https://discord.com/login', { waitUntil: 'domcontentloaded' });
      // Enrich with global auth options to be used by choose-account logic
      const mergedCfg = { ...accountCfg, __globalAuth: (cfg.auth || {}) };
      // 1) Stabilize first
      await stabilize(page, mergedCfg);
      // 2) Handle choose-account (auto: try add, otherwise connect)
      await handleChooseAccountIfPresent(page, mergedCfg).catch(() => {});
      // 3) Quick check: already logged after possible redirect?
      const quick = await detectLoggedQuick(page, 2000);
      if (!quick.logged) {
        // 4) Not logged: poke once more and run simple login
        try { await pokeChooseAccountIfVisible(page, mergedCfg); } catch {}
        await simpleLogin(page, mergedCfg, { skipGoto: true, skipInitialWait: true });
      }
      await simpleBump(page, mergedCfg);
      log(`${ICONS.success} [${sessionName}] Done.`);
    } catch (e) {
      console.error(`${ICONS.error} [${sessionName}] Error:`, e.message);
      if (accountCfg.webhookUrl) {
        await postWebhook(accountCfg.webhookUrl, { event: 'error', message: e.message || 'Unknown error', _meta: { session: accountCfg.sessionName || sessionName } });
      }
    }
    const close = accountCfg.closeBrowserOnFinish !== false; // par défaut on ferme
    if (close) {
      try { await browser.close(); log(`${ICONS.success} [${sessionName}] Browser closed (closeBrowserOnFinish).`); } catch {}
    } else {
      log(`${ICONS.info} [${sessionName}] Browser left open (closeBrowserOnFinish=false).`);
    }
  }

  // Normalisation des comptes (nouveau: cfg.accounts[] ; compat: racine + secondUser)
  const normalizedAccounts = (() => {
    if (Array.isArray(cfg.accounts) && cfg.accounts.length) return cfg.accounts;
    const acc = [];
    // compat ancien schéma
    const rootKeys = ['email','password','sessionName','channelUrl','webhookUrl','enableSecurityAction','startup','simpleDelays','bumpDelays','securityDelays'];
    if (cfg.email || cfg.sessionName || cfg.channelUrl) {
      const a = {};
      for (const k of rootKeys) if (k in cfg) a[k] = cfg[k];
      acc.push(a);
    }
    if (cfg.secondUser) acc.push({ ...cfg, ...cfg.secondUser });
    return acc;
  })();

  const loopCfg = cfg.loop || {};
  const loopEnabled = !!loopCfg.enabled && normalizedAccounts.length >= 2;
  const delayMs = (typeof loopCfg.delayMs === 'number')
    ? loopCfg.delayMs
    : (loopCfg.delayBetweenAccountsMs ?? cfg.secondUserDelayMs ?? 3600000); // compat
  const maxCycles = loopCfg.maxCycles ?? null; // null = infini

  // Loop & accounts summary
  log(`${ICONS.info} Loop: ${loopEnabled ? 'enabled' : 'disabled'}`);
  log(`${ICONS.info} Configured accounts: ${normalizedAccounts.length}`);
  if (normalizedAccounts.length) {
    const names = normalizedAccounts.map(a => a.sessionName || 'session').join(', ');
    log(`${ICONS.user} Sessions: ${names}`);
  }
  if (normalizedAccounts.length >= 2) {
    log(`${ICONS.time} Delay between runs: ${formatDelay(delayMs)}`);
  }
  if (maxCycles) log(`${ICONS.info} Max cycles limit: ${maxCycles}`);

  if (!loopEnabled) {
    // Non-loop mode: run each account once, with wait between
    for (let i = 0; i < normalizedAccounts.length; i++) {
      const accCfg = { ...normalizedAccounts[i] };
      await runAccount(accCfg);
      const isLast = i === normalizedAccounts.length - 1;
      if (!isLast && delayMs > 0) {
        log(`${ICONS.time} Waiting ${formatDelay(delayMs)} before next account`);
        await waitDelayWithProgress(delayMs, 'before next account');
      }
    }
    console.log(createSeparator('DONE', 'thick'));
    log(`${ICONS.success} All accounts processed (non-loop mode).`);
  } else {
    let cycle = 1;
    while (true) {
      console.log(createSeparator(`CYCLE #${cycle}`, 'cycle'));
      log(`${ICONS.cycle} Start of cycle #${cycle}`);
      console.log(createSeparator('', 'single'));

      for (let i = 0; i < normalizedAccounts.length; i++) {
        const acc = normalizedAccounts[i];
        const accCfg = { ...acc, __currentCycle: cycle };
        log(`${ICONS.user} Account ${i + 1}: ${accCfg.sessionName || 'session'}`);
        await runAccount(accCfg);
        // Uniform wait between each execution, including before next cycle
        log(`${ICONS.time} Waiting ${formatDelay(delayMs)} before next pass`);
        await waitDelayWithProgress(delayMs, `cycle ${cycle} → waiting`);
      }

      console.log(createSeparator(`END CYCLE #${cycle}`, 'cycle'));
      cycle += 1;
      if (maxCycles && cycle > maxCycles) {
        console.log(createSeparator('DONE', 'thick'));
        log(`${ICONS.success} Reached maximum cycles. End.`);
        break;
      }
    }
  }

  if (!loopEnabled) {
    if (cfg.keepAliveMs && cfg.keepAliveMs > 0) {
      log(`[keepAlive] Keeping process alive for ${formatDelay(cfg.keepAliveMs)} (browsers will remain open).`);
      await sleep(cfg.keepAliveMs);
      log('[keepAlive] End of keep-alive period.');
    }
  }
})();
