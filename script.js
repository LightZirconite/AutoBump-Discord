// Load config.json (supports comments)
async function loadConfig() {
  const raw = await fs.readFile(path.join(process.cwd(), 'config.json'), 'utf-8');
  // Strip comments (// or # at line start, and /* ... */ blocks)
  const noBlockComments = raw.replace(/\/\*[\s\S]*?\*\//g, '');
  const noLineComments = noBlockComments.replace(/^\s*(#|\/\/).*$/gm, '');
  return JSON.parse(noLineComments);
}
import { chromium } from 'playwright';
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

// Human-like randomization utilities
function randomDelay(base, variance = 0.3) {
  const min = base * (1 - variance);
  const max = base * (1 + variance);
  return Math.floor(min + Math.random() * (max - min));
}

function randomTypingSpeed() {
  return 60 + Math.random() * 80; // 60-140ms per char
}

async function humanClick(page, selector) {
  const element = await page.$(selector);
  if (!element) return false;
  
  const box = await element.boundingBox();
  if (!box) return false;
  
  // Click at random position within element (not always center)
  const x = box.x + box.width * (0.3 + Math.random() * 0.4);
  const y = box.y + box.height * (0.3 + Math.random() * 0.4);
  
  // Simulate mouse movement before click
  await page.mouse.move(x, y, { steps: 10 + Math.floor(Math.random() * 15) });
  await sleep(randomDelay(100, 0.5));
  await page.mouse.click(x, y);
  return true;
}

async function humanType(page, selector, text, options = {}) {
  const baseDelay = options.baseDelay || 85;
  await page.click(selector);
  await sleep(randomDelay(200, 0.5));
  
  for (const char of text) {
    await page.keyboard.type(char, { delay: randomDelay(baseDelay, 0.4) });
    // Occasional micro-pauses (human hesitation)
    if (Math.random() < 0.15) {
      await sleep(randomDelay(150, 0.6));
    }
  }
}

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

const browserPool = new Map();

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
      
      // Human-like typing for email
      await page.click(emailSel);
      await sleep(randomDelay(300, 0.5));
      for (const char of email) {
        await page.keyboard.type(char, { delay: randomDelay(80, 0.5) });
      }
      await sleep(randomDelay(afterTypeMs, 0.3));
      
      await page.waitForSelector(passSel, { timeout: 15000 });
      
      // Human-like typing for password
      await page.click(passSel);
      await sleep(randomDelay(250, 0.5));
      for (const char of password) {
        await page.keyboard.type(char, { delay: randomDelay(70, 0.5) });
      }
      await sleep(randomDelay(afterTypeMs, 0.3));
      
      const btn = await page.$('button[type="submit"]');
      if (btn) { 
        await humanClick(page, 'button[type="submit"]').catch(() => btn.click());
        await sleep(randomDelay(submitWaitMs, 0.3)); 
      }
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
      const { active, state, disconnected } = await ensureSessionActive(page);
      if (disconnected) {
        log(`${ICONS.error} Discord connection lost (WebSocket or overlay detected)`);
        throw new Error('Discord connection lost');
      }
      if (active) {
        const hint = state.path && !/\/login(\b|$)/.test(state.path) ? state.path : 'session active';
        log(`${ICONS.connected} Signed in (${hint}).`);
        return true;
      }
    } catch (e) {
      if (e.message && /connection lost/i.test(e.message)) throw e;
    }
    await sleep(2000);
  }
  throw new Error('Login timeout');
}

async function simpleBump(page, cfg) {
  const channelUrl = cfg.channelUrl || 'https://discord.com/channels/1150371679520968804/1300408274184830979';
  
  // Optional security step (may use different channel)
  if (cfg.enableSecurityAction !== false) {
    await configureSecurityActions24hInline(page, cfg);
  }

  log('Navigate to bump channel');
  await page.goto(channelUrl, { waitUntil: 'domcontentloaded' });
  const d = cfg.bumpDelays || {};
  const afterChannel = d.afterChannelMs ?? (cfg.simpleDelays?.afterChannelMs ?? 5000);
  const finalizeAfterBumpsMs = d.finalizeAfterBumpsMs ?? 4000; // extra safety delay after sending the two bumps
  await sleep(randomDelay(afterChannel, 0.2));

  const { active: sessionActive, state: sessionState } = await ensureSessionActive(page);
  if (!sessionActive) {
    const currentUrl = page.url();
    const reason = sessionState?.path && /\/login(\b|$)/.test(sessionState.path)
      ? `navigated to login (${sessionState.path})`
      : `current url ${currentUrl}`;
    throw new Error(`Session inactive before sending bumps (${reason})`);
  }

  // Bumps
  const betweenKeys = d.betweenKeysMs ?? 600;
  const afterFirstBump = d.afterFirstBumpMs ?? 1800;
  const afterSecondBump = d.afterSecondBumpMs ?? 1200;
  const inputSelector = 'div[data-slate-node="element"]';
  await page.waitForSelector(inputSelector, { timeout: 30000 });
  
  // Human-like interaction before typing
  await humanClick(page, inputSelector).catch(() => page.click(inputSelector));
  await sleep(randomDelay(400, 0.5));
  
  // First bump - human-like typing
  await humanType(page, inputSelector, '/bump', { baseDelay: 85 });
  await sleep(randomDelay(betweenKeys, 0.3));
  await page.keyboard.press('Enter');
  await sleep(randomDelay(500, 0.4));
  await page.keyboard.press('Enter');
  log(`${ICONS.bump} First bump sent`);
  await sleep(randomDelay(afterFirstBump, 0.2));
  
  // Second bump - slightly different timing (human behavior)
  await humanType(page, inputSelector, '/bump', { baseDelay: 90 });
  await sleep(randomDelay(betweenKeys, 0.3));
  await page.keyboard.press('ArrowDown');
  await sleep(randomDelay(400, 0.5));
  await page.keyboard.press('Enter');
  await sleep(randomDelay(500, 0.4));
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
  // Final small wait so Discord has time to process/send the last message before potential browser close
  if (finalizeAfterBumpsMs > 0) await sleep(finalizeAfterBumpsMs);
}

// Configure 24h security directly within the bump flow
async function configureSecurityActions24hInline(page, cfg) {
  const bothChannels = cfg.securityActionInBothChannels === true;
  const securityUrl = cfg.securityChannelUrl || cfg.channelUrl || 'https://discord.com/channels/1150371679520968804/1300408274184830979';
  const channelUrl = cfg.channelUrl || 'https://discord.com/channels/1150371679520968804/1300408274184830979';
  
  const channelsToProcess = [];
  
  if (bothChannels && cfg.securityChannelUrl) {
    // Both channels mode: security channel first, then bump channel
    channelsToProcess.push({ url: securityUrl, label: 'security channel' });
    channelsToProcess.push({ url: channelUrl, label: 'bump channel' });
  } else {
    // Single channel mode: use securityChannelUrl if set, otherwise channelUrl
    channelsToProcess.push({ url: securityUrl, label: cfg.securityChannelUrl ? 'security channel' : 'bump channel' });
  }
  
  for (const channel of channelsToProcess) {
    await performSecurityActionOnChannel(page, cfg, channel.url, channel.label);
  }
}

async function performSecurityActionOnChannel(page, cfg, targetUrl, label) {
  // Navigate to target channel
  log(`[Security] Navigate to ${label}`);
  await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });
  await sleep(randomDelay(3000, 0.3));
  
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
  await sleep(randomDelay(preClick, 0.3));

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

  // Human-like click on security button
  const clicked = await humanClick(page, buttonSelector).catch(async () => {
    try { await page.click(buttonSelector); return true; } catch { return false; }
  });
  if (clicked) log('[Security] Panel opened (button click)');
  else { log('[Security] Failed to click button'); return; }
  await sleep(randomDelay(afterButton, 0.3));

  // Open dropdown with human-like behavior
  try { 
    await humanClick(page, selectWrapper).catch(() => page.click(selectWrapper)); 
    log('[Security] Dropdown opened'); 
  } catch { 
    try { 
      await humanClick(page, valueSelector).catch(() => page.click(valueSelector)); 
      log('[Security] Opened via value'); 
    } catch { 
      log('[Security] Could not open dropdown'); 
    } 
  }
  await sleep(randomDelay(afterSelectOpen, 0.3));

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
  await sleep(randomDelay(afterOption, 0.3));

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
    if (!saveClicked) await sleep(randomDelay(savePollIntervalMs, 0.3));
  }
  if (saveClicked) {
    log('[Security] Save button clicked');
  } else if (saveFound) {
    log('[Security] Save button found but click may be blocked/ineffective');
  } else {
    log('[Security] Save button not found (timeout)');
  }
  await sleep(randomDelay(afterSave, 0.3));

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
      await page.screenshot({ path: `security-fail-${Date.now()}.png`, fullPage: false });
      log('[Security] Debug screenshot captured');
    } catch {}
  }
  if (cfg.webhookUrl && confirmed) {
    const sessionLabel = cfg.sessionName || 'session';
    const cycle = cfg.__currentCycle;
    const meta = { session: sessionLabel, channel: label, picked, saveClicked };
    if (cycle !== undefined) meta.cycle = cycle;
    await postWebhook(cfg.webhookUrl, { event: 'security-activated', message: `Security 24h enabled in ${label}`, _meta: meta });
  }

  // Send a message in the channel to confirm the 24h activation
  if (confirmed) {
    const defaultMsg = 'Security 24h enabled ✅';
    const chatMsg = (cfg.messages && cfg.messages.securityActivated && cfg.messages.securityActivated.text) || defaultMsg;
    try {
      await sendChannelMessage(page, chatMsg, cfg);
      log(`[Security] Confirmation message sent to ${label}`);
    } catch (e) {
      log(`[Security] Failed to send confirmation message to ${label}`);
    }
  }
}

// Send a simple text message in the current channel
async function sendChannelMessage(page, text, cfg) {
  const inputSelector = 'div[data-slate-node="element"]';
  await page.waitForSelector(inputSelector, { timeout: 30000 });
  
  // Human-like message sending
  await humanClick(page, inputSelector).catch(() => page.click(inputSelector));
  await sleep(randomDelay(200, 0.5));
  
  // Type with human-like variance
  for (const char of text) {
    await page.keyboard.type(char, { delay: randomDelay(75, 0.4) });
    if (Math.random() < 0.1) await sleep(randomDelay(120, 0.6));
  }
  
  await sleep(randomDelay(200, 0.5));
  await page.keyboard.press('Enter');
  await sleep(randomDelay(300, 0.4));
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

function getBrowserEntry(key) {
  const entry = browserPool.get(key);
  if (!entry) return null;
  const browser = entry.browser;
  if (!browser) {
    browserPool.delete(key);
    return null;
  }
  if (entry.page && entry.page.isClosed()) {
    entry.page = null;
  }
  return entry;
}

function rememberBrowserEntry(key, entry) {
  browserPool.set(key, entry);
  if (!entry._closeHandler && entry.browser && typeof entry.browser.on === 'function') {
    entry._closeHandler = () => browserPool.delete(key);
    entry.browser.on('close', entry._closeHandler);
  }
  return entry;
}

async function shutdownAllBrowsers() {
  for (const [key, entry] of browserPool.entries()) {
    try {
      if (entry?.browser) await entry.browser.close();
    } catch {}
    browserPool.delete(key);
  }
}

// Stabilize startup to let the browser/session load
async function stabilize(page, cfg) {
  const startup = cfg.startup || {};
  const stabilizationMs = startup.stabilizationMs ?? 30000;
  log(`Browser startup stabilization ${stabilizationMs}ms`);
  await sleep(stabilizationMs);
}

async function readSessionState(page) {
  try {
    return await page.evaluate(() => {
      const path = location?.pathname || '';
      const isLoginPath = /\/login(\b|$)/.test(path);
      const hasAppShell = !!document.querySelector('#app-mount [class*="sidebar"], #app-mount nav, [data-list-id="guildsnav"], nav[aria-label], [class*="guildsNav"]');
      const isAuthSplitView = !!document.querySelector('section[class*="splitContainer"], section[class*="authBox"]');
      return { path, isLoginPath, hasAppShell, isAuthSplitView };
    });
  } catch {
    return { path: '', isLoginPath: false, hasAppShell: false, isAuthSplitView: false };
  }
}

// Vérifie si la session Discord est active (sidebar présente ET pas de message d'erreur de déconnexion)
async function ensureSessionActive(page) {
  const state = await readSessionState(page);
  // Vérifie la présence d'un message d'erreur de déconnexion
  let disconnected = false;
  try {
    disconnected = await page.evaluate(() => {
      // Discord affiche souvent un message "Reconnecting" ou "Connection lost"
      const errorBanner = document.querySelector('[class*="connectionError"]') || document.querySelector('[class*="reconnect"]');
      if (errorBanner && errorBanner.textContent) {
        return /connect|reconnect|déconnecté|perdu/i.test(errorBanner.textContent);
      }
      // Certains overlays affichent "Lost connection" ou "Trying to reconnect"
      const overlays = Array.from(document.querySelectorAll('div, span')).filter(e => e.textContent && /connect|reconnect|déconnecté|perdu/i.test(e.textContent));
      return overlays.length > 0;
    });
  } catch {}
  if (disconnected) return { active: false, state, disconnected: true };
  if (!state.isLoginPath && state.hasAppShell) return { active: true, state };
  if (!state.isLoginPath) return { active: true, state };
  return { active: false, state };
}

// Quick login-state detection: small window to see if URL leaves /login
async function detectLoggedQuick(page, timeoutMs = 2000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const { active, state } = await ensureSessionActive(page);
    if (active) {
      const hint = state.path || page.url();
      log(`URL left /login -> session active (${hint})`);
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
  LOG_MINIMAL = !!(cfg.logging?.minimal);
  LOG_COLORED = !!(cfg.logging?.colored);
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

  const gracefulStop = (signal) => {
    log(`${ICONS.warning} Received ${signal}, closing browsers...`);
    shutdownAllBrowsers().finally(() => process.exit(0));
  };
  for (const sig of ['SIGINT', 'SIGTERM']) {
    if (!process.listenerCount(sig)) {
      process.once(sig, () => gracefulStop(sig));
    }
  }

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
    const sessionKey = sessionName;
    const userDataDir = path.join(sessionRoot, sessionName);
  const runtimeCfg = cfg.runtime || {};
  const keepBrowserOpen = accountCfg.keepBrowserOpen ?? runtimeCfg.keepBrowserOpen ?? false;
  const reuseBrowser = keepBrowserOpen && (accountCfg.reuseBrowser ?? runtimeCfg.reuseBrowser ?? true);

    const globalReset = cfg.auth?.resetSessionOnStart;
    const shouldResetSession = accountCfg.resetSessionOnStart || (typeof accountCfg.resetSessionOnStart === 'undefined' && globalReset);
  let poolEntry = reuseBrowser ? getBrowserEntry(sessionKey) : null;
    if (shouldResetSession) {
      if (poolEntry?.browser) {
        try { await poolEntry.browser.close(); } catch {}
        browserPool.delete(sessionKey);
        poolEntry = null;
      }
      try { await fs.rm(userDataDir, { recursive: true, force: true }); } catch {}
    }

    const extraArgs = [
      '--window-size=1280,800',
      '--window-position=100,50',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-blink-features=AutomationControlled',
      '--disable-dev-shm-usage',
      '--disable-infobars',
      '--disable-features=IsolateOrigins',
      '--disable-site-isolation-trials',
      '--enable-features=NetworkService,NetworkServiceInProcess',
      '--disable-automation',
      '--excludeSwitches=enable-automation',
      '--disable-component-extensions-with-background-pages',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      '--disable-features=TranslateUI',
      '--disable-hang-monitor',
      '--disable-ipc-flooding-protection',
      '--disable-popup-blocking',
      '--disable-prompt-on-repost',
      '--disable-sync',
      '--force-color-profile=srgb',
      '--metrics-recording-only',
      '--enable-automation=false',
      '--password-store=basic',
      '--use-mock-keychain'
    ];

    function isWSL() {
      return process.platform === 'linux' && /microsoft/i.test(os.release());
    }

    async function fileExists(p) {
      try { await fs.access(p); return true; } catch { return false; }
    }

    async function findLocalChromeWindows() {
      const env = process.env;
      const candidates = [
        path.join(env["PROGRAMFILES"] || 'C:\\Program Files', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
        path.join(env["PROGRAMFILES(X86)"] || 'C:\\Program Files (x86)', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
        env["LOCALAPPDATA"] ? path.join(env["LOCALAPPDATA"], 'Microsoft', 'Edge SxS', 'Application', 'msedge.exe') : null,
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
      const fromEnv = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || process.env.PUPPETEER_EXECUTABLE_PATH;
      if (fromEnv && await fileExists(fromEnv)) return fromEnv;

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

      return null;
    }

    const headlessMode = (() => {
      if (typeof accountCfg.headless !== 'undefined') return accountCfg.headless;
      if (process.platform === 'linux' || isWSL()) {
        return process.env.DISPLAY ? false : true;
      }
      return false;
    })();

    const execPath = await resolveExecutablePath();
    const launchOptions = { 
      headless: headlessMode, 
      channel: execPath ? undefined : 'msedge',
      args: extraArgs,
      viewport: { width: 1280, height: 800 },
      locale: 'en-US',
      timezoneId: 'America/New_York',
      permissions: ['notifications'],
      colorScheme: 'dark',
      deviceScaleFactor: 1,
      ignoreDefaultArgs: [
        '--enable-automation',
        '--enable-blink-features=IdleDetection',
        '--enable-logging'
      ],
      chromiumSandbox: true,
      bypassCSP: false,
      javaScriptEnabled: true,
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0',
      extraHTTPHeaders: {
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
        'Upgrade-Insecure-Requests': '1',
        'sec-ch-ua': '"Microsoft Edge";v="130", "Chromium";v="130", "Not?A_Brand";v="99"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"'
      }
    };
    if (execPath) launchOptions.executablePath = execPath;

    let browser;
    let page;
    let context;
    if (poolEntry?.browser) {
      browser = poolEntry.browser;
      context = poolEntry.context;
      const maybePage = poolEntry.page;
      if (maybePage && !maybePage.isClosed()) {
        page = maybePage;
      }
      log(`${ICONS.browser} [${sessionName}] Reusing existing browser instance`);
    } else {
      log(`[${sessionName}] Opening browser`);
      browser = await chromium.launchPersistentContext(userDataDir, launchOptions);
      context = browser;
      if (reuseBrowser) {
        poolEntry = rememberBrowserEntry(sessionKey, { browser, context, page: null, loggedIn: false, initialized: false });
      }
    }

    if (!page) {
      const pages = context.pages();
      page = pages.find(p => !p.isClosed()) || await context.newPage();
      
      // Comprehensive anti-detection script
      await page.addInitScript(() => {
        // 1. Override navigator.webdriver
        Object.defineProperty(navigator, 'webdriver', {
          get: () => undefined,
        });
        
        // 2. Mock chrome object
        window.chrome = {
          runtime: {},
          loadTimes: function() {},
          csi: function() {},
          app: {}
        };
        
        // 3. Override permissions API
        const originalQuery = window.navigator.permissions.query;
        window.navigator.permissions.query = (parameters) => (
          parameters.name === 'notifications' ?
            Promise.resolve({ state: Notification.permission }) :
            originalQuery(parameters)
        );
        
        // 4. Mock plugins (realistic list)
        Object.defineProperty(navigator, 'plugins', {
          get: () => [
            { name: 'PDF Viewer', filename: 'internal-pdf-viewer' },
            { name: 'Chrome PDF Viewer', filename: 'internal-pdf-viewer' },
            { name: 'Chromium PDF Viewer', filename: 'internal-pdf-viewer' },
            { name: 'Microsoft Edge PDF Viewer', filename: 'internal-pdf-viewer' },
            { name: 'WebKit built-in PDF', filename: 'internal-pdf-viewer' }
          ],
        });
        
        // 5. Languages
        Object.defineProperty(navigator, 'languages', {
          get: () => ['en-US', 'en'],
        });
        
        // 6. Override Playwright-specific properties
        delete navigator.__playwright;
        delete navigator.__pw_manual;
        delete navigator.__fxdriver_unwrapped;
        delete window.callPhantom;
        delete window._phantom;
        
        // 7. WebGL Vendor (not "Google Inc.")
        const getParameter = WebGLRenderingContext.prototype.getParameter;
        WebGLRenderingContext.prototype.getParameter = function(parameter) {
          if (parameter === 37445) {
            return 'Intel Inc.';
          }
          if (parameter === 37446) {
            return 'Intel Iris OpenGL Engine';
          }
          return getParameter.call(this, parameter);
        };
        
        // 8. Battery API (realistic)
        if ('getBattery' in navigator) {
          navigator.getBattery = () => Promise.resolve({
            charging: true,
            chargingTime: 0,
            dischargingTime: Infinity,
            level: 1,
            addEventListener: () => {},
            removeEventListener: () => {}
          });
        }
        
        // 9. Connection (realistic)
        if ('connection' in navigator) {
          Object.defineProperty(navigator, 'connection', {
            get: () => ({
              effectiveType: '4g',
              downlink: 10,
              rtt: 50,
              saveData: false
            })
          });
        }
        
        // 10. Media devices
        if (navigator.mediaDevices && navigator.mediaDevices.enumerateDevices) {
          const origEnumerate = navigator.mediaDevices.enumerateDevices.bind(navigator.mediaDevices);
          navigator.mediaDevices.enumerateDevices = async () => {
            const devices = await origEnumerate();
            return devices.length > 0 ? devices : [
              { deviceId: 'default', kind: 'audioinput', label: '', groupId: '' },
              { deviceId: 'default', kind: 'audiooutput', label: '', groupId: '' },
              { deviceId: 'default', kind: 'videoinput', label: '', groupId: '' }
            ];
          };
        }
        
        // 11. Hide automation from stack traces
        Error.stackTraceLimit = 10;
        
        // 12. Mock hardware concurrency (realistic)
        Object.defineProperty(navigator, 'hardwareConcurrency', {
          get: () => 8
        });
        
        // 13. Mock device memory
        Object.defineProperty(navigator, 'deviceMemory', {
          get: () => 8
        });
      });
    }

    if (reuseBrowser && poolEntry) {
      poolEntry.page = page;
    }

    if (accountCfg.cleanupBlankPages !== false) {
      const openPages = context.pages();
      for (const extraPage of openPages) {
        if (extraPage === page) continue;
        try {
          if ((extraPage.url() || '').startsWith('about:blank')) await extraPage.close();
        } catch {}
      }
    }

    const mergedCfg = { ...accountCfg, __globalAuth: (cfg.auth || {}) };

    const initializeIfNeeded = async () => {
      if (!reuseBrowser || !poolEntry) {
        await stabilize(page, mergedCfg);
        return;
      }
      if (!poolEntry.initialized) {
        await stabilize(page, mergedCfg);
        poolEntry.initialized = true;
      }
    };

    const performLoginFlow = async () => {
      log(`${ICONS.browser} [${sessionName}] Navigating to login page`);
      await page.goto('https://discord.com/login', { waitUntil: 'domcontentloaded' });
      await initializeIfNeeded();
      await handleChooseAccountIfPresent(page, mergedCfg).catch(() => {});
      const quick = await detectLoggedQuick(page, 2000);
      if (quick.logged) {
        if (poolEntry) poolEntry.loggedIn = true;
        return true;
      }
      try { await pokeChooseAccountIfVisible(page, mergedCfg); } catch {}
      const logged = await simpleLogin(page, mergedCfg, { skipGoto: true, skipInitialWait: true });
      if (logged && poolEntry) poolEntry.loggedIn = true;
      return logged;
    };

    const notifyError = async (message) => {
      if (accountCfg.webhookUrl) {
        await postWebhook(accountCfg.webhookUrl, { event: 'error', message, _meta: { session: accountCfg.sessionName || sessionName } });
      }
    };

    let needsLogin = !reuseBrowser || !poolEntry || !poolEntry.loggedIn;
    let attempts = 0;
    let bumpSuccess = false;
    while (attempts < 2 && !bumpSuccess) {
      attempts += 1;
      if (needsLogin) {
        try {
          await performLoginFlow();
          needsLogin = false;
        } catch (loginErr) {
          const loginMsg = loginErr?.message || String(loginErr);
          console.error(`${ICONS.error} [${sessionName}] Login error:`, loginMsg);
          await notifyError(loginMsg);
          break;
        }
      } else {
        log(`${ICONS.connected} [${sessionName}] Using existing authenticated session`);
      }

      try {
        await simpleBump(page, mergedCfg);
        bumpSuccess = true;
        if (poolEntry) poolEntry.loggedIn = true;
        log(`${ICONS.success} [${sessionName}] Done.`);
      } catch (err) {
        const errMsg = err?.message || String(err);
        console.error(`${ICONS.error} [${sessionName}] Error:`, errMsg);
        // Si la session est perdue ou Discord est déconnecté, on force la suppression du dossier de session et la fermeture du navigateur
        if (/connection lost|session inactive/i.test(errMsg)) {
          log(`${ICONS.warning} [${sessionName}] Session/browser will be reset due to lost connection.`);
          try { await browser.close(); } catch {}
          try { await fs.rm(userDataDir, { recursive: true, force: true }); } catch {}
          browserPool.delete(sessionKey);
          needsLogin = true;
          continue;
        }
        if (!needsLogin && attempts < 2) {
          log(`${ICONS.warning} [${sessionName}] Bump failed, retrying with fresh login.`);
          needsLogin = true;
          continue;
        }
        await notifyError(errMsg);
        break;
      }
    }

    const shouldCloseBrowser = accountCfg.closeBrowserOnFinish ?? !keepBrowserOpen;

    if (shouldCloseBrowser) {
      try { await browser.close(); log(`${ICONS.success} [${sessionName}] Browser closed.`); } catch {}
      if (reuseBrowser) browserPool.delete(sessionKey);
    } else if (keepBrowserOpen && reuseBrowser && poolEntry) {
      try { await page.bringToFront(); } catch {}
      log(`${ICONS.info} [${sessionName}] Browser kept open for reuse.`);
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
  // Add a random jitter on top of the base delay to avoid predictable schedules
  // Default jitter max: 30 minutes if not specified
  const jitterMaxMs = Math.max(0, loopCfg.jitterMsMax ?? loopCfg.randomJitterMsMax ?? (loopEnabled ? 30 * 60 * 1000 : 0));
  const computeJitteredDelay = () => {
    if (!jitterMaxMs) return { total: delayMs, jitter: 0 };
    const jitter = Math.floor(Math.random() * (jitterMaxMs + 1));
    return { total: delayMs + jitter, jitter };
  };
  const perAccountSchedule = !!(loopCfg.perAccountSchedule || loopCfg.scheduleMode === 'per-account');
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
        const { total, jitter } = computeJitteredDelay();
        if (jitter > 0) {
          log(`${ICONS.time} Waiting ${formatDelay(total)} before next account (+${formatDelay(jitter)} random)`);
        } else {
          log(`${ICONS.time} Waiting ${formatDelay(total)} before next account`);
        }
        await waitDelayWithProgress(total, 'before next account');
      }
    }
    console.log(createSeparator('DONE', 'thick'));
    log(`${ICONS.success} All accounts processed (non-loop mode).`);
  } else if (!perAccountSchedule) {
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
        const { total, jitter } = computeJitteredDelay();
        if (jitter > 0) {
          log(`${ICONS.time} Waiting ${formatDelay(total)} before next pass (+${formatDelay(jitter)} random)`);
        } else {
          log(`${ICONS.time} Waiting ${formatDelay(total)} before next pass`);
        }
        await waitDelayWithProgress(total, `cycle ${cycle} → waiting`);
      }

      console.log(createSeparator(`END CYCLE #${cycle}`, 'cycle'));
      cycle += 1;
      if (maxCycles && cycle > maxCycles) {
        console.log(createSeparator('DONE', 'thick'));
        log(`${ICONS.success} Reached maximum cycles. End.`);
        break;
      }
    }
  } else {
    // Per-account scheduler: maximize bumps/day by scheduling each account independently
    const baseCooldownMs = (typeof loopCfg.cooldownMsBase === 'number')
      ? loopCfg.cooldownMsBase
      : (typeof delayMs === 'number' ? delayMs : 2 * 60 * 60 * 1000); // default 2h if unspecified
    const jitterMax = Math.max(0, loopCfg.jitterMsMax ?? loopCfg.randomJitterMsMax ?? 30 * 60 * 1000);

    function computeNextDelay() {
      const jitter = jitterMax ? Math.floor(Math.random() * (jitterMax + 1)) : 0;
      return { total: baseCooldownMs + jitter, jitter };
    }

    const now = Date.now();
    const schedule = normalizedAccounts.map((acc) => ({ cfg: { ...acc }, nextAt: now }));
    let runCount = 0;
    const maxRuns = typeof loopCfg.maxRuns === 'number' ? loopCfg.maxRuns : null; // optional global cap

    while (true) {
      // Find the next due account
      schedule.sort((a, b) => a.nextAt - b.nextAt);
      const next = schedule[0];
      const waitMs = Math.max(0, next.nextAt - Date.now());
      if (waitMs > 0) {
        const label = `until ${next.cfg.sessionName || 'session'} next run`;
        log(`${ICONS.time} Waiting ${formatDelay(waitMs)} ${jitterMax ? '(with randomization per account)' : ''}`);
        await waitDelayWithProgress(waitMs, label);
      }

      // Run the due account
      log(`${ICONS.user} Account: ${next.cfg.sessionName || 'session'}`);
      await runAccount({ ...next.cfg });
      runCount += 1;

      // Schedule its next run
      const { total, jitter } = computeNextDelay();
      next.nextAt = Date.now() + total;
      const jitterInfo = jitter ? ` (+${formatDelay(jitter)} random)` : '';
      log(`${ICONS.time} Next for ${next.cfg.sessionName || 'session'} in ${formatDelay(total)}${jitterInfo}`);

      if (maxRuns && runCount >= maxRuns) {
        console.log(createSeparator('DONE', 'thick'));
        log(`${ICONS.success} Reached max runs (${maxRuns}). End.`);
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
