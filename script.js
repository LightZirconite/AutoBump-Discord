// Charge config.json (supporte les commentaires)
async function loadConfig() {
  const raw = await fs.readFile(path.join(process.cwd(), 'config.json'), 'utf-8');
  // Retire les commentaires (// ou # en début de ligne, ou /* ... */)
  const noBlockComments = raw.replace(/\/\*[\s\S]*?\*\//g, '');
  const noLineComments = noBlockComments.replace(/^\s*(#|\/\/).*$/gm, '');
  return JSON.parse(noLineComments);
}
import puppeteer from 'puppeteer';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

// Script simplifié: login séquentiel + envoi /bump
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let LOG_MINIMAL = false;
let LOG_COLORED = false;
const ESSENTIAL_PATTERNS = [
  /Ouverture navigateur/,
  /Accès initial page login/,
  /Deux bumps effectués|2ème bump envoyé/,
  /Sécurité 24h activée/,
  /Erreur:/,
  /Navigateur fermé/,
  /Lancement second compte/,
  /Tous les comptes traités/,
  /Sécurité] Confirmé 24h/,
];
// Icônes et symboles pour l'affichage
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
  if (/Erreur|error/i.test(msg)) return COLORS.brightRed + COLORS.bold;
  if (/Sécurité.*Confirmé|Sécurité 24h activée/.test(msg)) return COLORS.brightGreen + COLORS.bold;
  if (/Deux bumps effectués|2ème bump envoyé|1er bump envoyé/.test(msg)) return COLORS.brightCyan + COLORS.bold;
  if (/Ouverture navigateur|Accès initial/.test(msg)) return COLORS.brightBlue;
  if (/Navigateur fermé/.test(msg)) return COLORS.magenta;
  if (/Lancement second compte|cycle/.test(msg)) return COLORS.brightYellow + COLORS.bold;
  if (/Connecté|session active/.test(msg)) return COLORS.brightGreen;
  if (/Observation|Attente|Progression/.test(msg)) return COLORS.gray;
  if (/\[Sécurité\]/.test(msg)) return COLORS.cyan;
  return COLORS.reset;
}

function getIcon(msg) {
  if (/Erreur|error/i.test(msg)) return ICONS.error;
  if (/Sécurité.*Confirmé|Sécurité 24h activée/.test(msg)) return ICONS.security;
  if (/bump envoyé/.test(msg)) return ICONS.bump;
  if (/Ouverture navigateur/.test(msg)) return ICONS.browser;
  if (/Navigateur fermé/.test(msg)) return ICONS.success;
  if (/cycle/.test(msg)) return ICONS.cycle;
  if (/Connecté|session active/.test(msg)) return ICONS.connected;
  if (/Observation|Attente|Progression/.test(msg)) return ICONS.loading;
  if (/\[Sécurité\]/.test(msg)) return ICONS.security;
  if (/Lancement/.test(msg)) return ICONS.progress;
  return ICONS.bullet;
}

function log(msg) {
  if (LOG_MINIMAL) {
    const keep = ESSENTIAL_PATTERNS.some(r => r.test(msg));
    if (!keep) return;
  }
  const timestamp = new Date().toLocaleTimeString('fr-FR');
  const icon = getIcon(msg);
  if (LOG_COLORED) {
    const color = colorFor(msg);
    console.log(`${COLORS.dim}[${timestamp}]${COLORS.reset} ${color}${icon} ${msg}${COLORS.reset}`);
  } else {
    console.log(`[${timestamp}] ${icon} ${msg}`);
  }
}
// (bloc intrus supprimé)

// Connexion simple: renseigne email/mot de passe si disponibles, sinon attend la connexion
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
      log('Tentative de connexion envoyée');
    } catch (e) {
      log('Impossible de renseigner automatiquement les identifiants; poursuite en manuel.');
    }
  } else {
    log('Identifiants non fournis; connecte-toi manuellement si requis.');
  }

  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    try {
      const connected = await page.evaluate(() => {
        return !!(document.querySelector('#app-mount [class*="sidebar"], #app-mount nav'));
      });
      if (connected) { log(`${ICONS.connected} Connecté.`); return true; }
    } catch {}
    await sleep(2000);
  }
  throw new Error('Timeout login');
}

async function simpleBump(page, cfg) {
  const channelUrl = cfg.channelUrl || 'https://discord.com/channels/1150371679520968804/1300408274184830979';
  log('Aller au salon bump');
  await page.goto(channelUrl, { waitUntil: 'domcontentloaded' });
  const d = cfg.bumpDelays || {};
  const afterChannel = d.afterChannelMs ?? (cfg.simpleDelays?.afterChannelMs ?? 5000);
  await sleep(afterChannel);

  // Étape sécurité (optionnelle)
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
  // 1er bump
  await page.keyboard.type('/bump', { delay: 85 });
  await sleep(betweenKeys);
  await page.keyboard.press('Enter');
  await sleep(500);
  await page.keyboard.press('Enter');
  log(`${ICONS.bump} 1er bump envoyé`);
  await sleep(afterFirstBump);
  // 2ème bump
  await page.keyboard.type('/bump', { delay: 85 });
  await sleep(betweenKeys);
  await page.keyboard.press('ArrowDown');
  await sleep(400);
  await page.keyboard.press('Enter');
  await sleep(500);
  await page.keyboard.press('Enter');
  log(`${ICONS.bump} 2ème bump envoyé`);
  if (cfg.webhookUrl) {
    const sessionLabel = cfg.sessionName || 'session';
    const cycle = cfg.__currentCycle;
    const meta = { session: sessionLabel, channel: cfg.channelUrl || 'inconnu' };
    if (cycle !== undefined) meta.cycle = cycle;
    await postWebhook(cfg.webhookUrl, { event: 'bumps-complete', message: 'Deux bumps effectués', _meta: meta });
  }
  await sleep(afterSecondBump);
}

// Configure sécurité directement dans le flux bump
async function configureSecurityActions24hInline(page, cfg) {
  const d = cfg.securityDelays || {};
  const preClick = d.preClickButtonMs ?? 800;
  const afterButton = d.afterClickButtonMs ?? 1600;
  const afterSelectOpen = d.afterSelectOpenMs ?? 1000;
  const afterOption = d.afterOptionClickMs ?? 1200;
  const afterSave = d.afterSaveMs ?? 1600; // utilisé maintenant comme simple pause post-sélection
  const waitSaveButtonMs = d.waitSaveButtonMs ?? 6000; // nouveau: temps max d'apparition du bouton Sauvegarder
  const savePollIntervalMs = d.savePollIntervalMs ?? 400; // intervalle de polling
  const confirmWaitMs = d.confirmWaitMs ?? 7000; // temps max pour voir la valeur 24h appliquée
  const confirmPollIntervalMs = d.confirmPollIntervalMs ?? 500;
  const securityDebugOnFail = !!d.securityDebugOnFail;
  const buttonSelector = 'button.button__6e2b9.actionButton__36c3e';
  const selectWrapper = 'div.wrapper__3412a.select__3f413';
  const valueSelector = 'div.value__3f413';
  const option24Selector = 'div.option__3f413';

  try { await page.waitForSelector(buttonSelector, { timeout: 10000 }); } catch { log('[Sécurité] Bouton introuvable -> abandon'); return; }
  log('[Sécurité] Bouton détecté');
  await sleep(preClick);

  // Déjà configuré ?
  try {
    const already = await page.evaluate(sel => {
      const val = document.querySelector(sel);
      if (!val) return false;
      const txt = (val.textContent||'').toLowerCase();
      return txt.includes('24');
    }, valueSelector);
    if (already) { log('[Sécurité] Déjà configuré sur 24h -> skip'); if (cfg.webhookUrl) await postWebhook(cfg.webhookUrl, { event: 'security-skip', message: 'Déjà 24h' }); return; }
  } catch { log('[Sécurité] Impossible de lire l’état initial'); }

  try { await page.click(buttonSelector); log('[Sécurité] Panneau ouvert (clic bouton)'); } catch { log('[Sécurité] Échec clic bouton'); return; }
  await sleep(afterButton);

  // Ouvrir le menu déroulant
  try { await page.click(selectWrapper); log('[Sécurité] Sélecteur ouvert'); } catch { try { await page.click(valueSelector); log('[Sécurité] Ouverture via value'); } catch { log('[Sécurité] Impossible ouvrir sélecteur'); } }
  await sleep(afterSelectOpen);

  // Cliquer sur option 24h exacte
  let picked = false;
  try {
    picked = await page.evaluate(optSel => {
      const opts = Array.from(document.querySelectorAll(optSel));
      const target = opts.find(o => /24/.test((o.textContent||'')));
      if (target) { target.dispatchEvent(new MouseEvent('click', { bubbles:true })); return true; }
      return false;
    }, option24Selector);
  } catch { }
  log(picked ? '[Sécurité] Option 24h sélectionnée' : '[Sécurité] Option 24h NON trouvée');
  await sleep(afterOption);

  // Recherche et clic sur le bouton Sauvegarder (polling texte, insensible aux classes)
  // Stratégie: on poll jusqu'à waitSaveButtonMs, on essaie plusieurs modes de clic.
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
        const needle = /sauvegarder/i;
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
    log('[Sécurité] Bouton Sauvegarder cliqué');
  } else if (saveFound) {
    log('[Sécurité] Bouton Sauvegarder trouvé mais clic possiblement bloqué / non effectif');
  } else {
    log('[Sécurité] Bouton Sauvegarder non trouvé (timeout)');
  }
  await sleep(afterSave);

  // Vérification finale avec polling
  let confirmed = false;
  const tConfStart = Date.now();
  while (Date.now() - tConfStart < confirmWaitMs && !confirmed) {
    try {
      confirmed = await page.evaluate(sel => {
        const val = document.querySelector(sel);
        if (!val) return false;
        const txt = (val.textContent||'').toLowerCase();
        // Accepter différentes formes contenant 24
        return /24/.test(txt);
      }, valueSelector);
    } catch {}
    if (!confirmed) await sleep(confirmPollIntervalMs);
  }
  if (confirmed) {
    log('[Sécurité] Confirmé 24h (final)');
  } else if (securityDebugOnFail) {
    log(`[Sécurité] NON confirmé 24h (debug)${saveClicked ? ' (malgré clic Sauvegarder)' : ''}`);
  }
  if (!confirmed && securityDebugOnFail) {
    try {
      await page.screenshot({ path: `security-fail-${Date.now()}.png` });
      log('[Sécurité] Screenshot debug capturé');
    } catch {}
  }
  if (cfg.webhookUrl && confirmed) {
    const sessionLabel = cfg.sessionName || 'session';
    const cycle = cfg.__currentCycle;
    const meta = { session: sessionLabel, picked, saveClicked };
    if (cycle !== undefined) meta.cycle = cycle;
    await postWebhook(cfg.webhookUrl, { event: 'security-activated', message: 'Sécurité 24h activée', _meta: meta });
  }

  // Envoi d'un message dans le salon pour confirmer l'activation 24h
  if (confirmed) {
    const defaultMsg = 'Sécurité 24h activée ✅';
    const chatMsg = (cfg.messages && cfg.messages.securityActivated && cfg.messages.securityActivated.text) || defaultMsg;
    try {
      await sendChannelMessage(page, chatMsg, cfg);
      log('[Sécurité] Message de confirmation envoyé dans le salon');
    } catch (e) {
      log('[Sécurité] Échec d\'envoi du message de confirmation dans le salon');
    }
  }
}

// Envoie un message texte simple dans le salon courant
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
  const embedOnly = payload.embedOnly ?? true; // désormais par défaut embed
  const globalEmbedOnly = typeof payload.embedOnly === 'undefined' ? true : payload.embedOnly;
  const event = payload.event || 'event';
  const message = payload.message || '';
  const account = payload.accountLabel || (payload._meta && (payload._meta.session || payload._meta.account)) || 'session';
  // Couleurs par type
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
      log('Webhook erreur (embed)');
    }
  } else {
    try {
      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: `[${event}] ${message}` })
      });
    } catch (e) {
      log('Webhook erreur (content)');
    }
  }
}

// Envoi embed (Discord) – fallback silencieux si échec
async function postWebhookEmbed(url, { title, description, color = 5793266, fields = [], footer, timestamp = true }) {
  // Gardé pour compat rétro mais redirige vers postWebhook
  return postWebhook(url, { event: title || 'info', message: description || '', embedOnly: true, _meta: Object.fromEntries(fields.map(f => [f.name || 'field', f.value])) });
}

// Nouvelle détection: on ouvre d'abord /login et on observe l'URL pendant ~20s.
// Si après la fenêtre d'observation l'URL n'est plus /login => déjà connecté.
// Sinon => pas connecté, on doit faire le login manuel.
async function detectExistingSession(page, cfg) {
  const startup = cfg.startup || {};
  const stabilizationMs = startup.stabilizationMs ?? 30000; // temps laissé au navigateur pour charger la session
  const detectTotal = startup.loginDetectWaitMs ?? 20000; // observation après stabilisation
  const step = startup.loginDetectProgressStepMs ?? 5000;

  log(`Stabilisation lancement navigateur ${stabilizationMs}ms`);
  await sleep(stabilizationMs);
  log('Début observation URL pour déterminer état session');
  const t0 = Date.now();
  let lastPath = '';
  while (Date.now() - t0 < detectTotal) {
    const u = page.url();
    try { lastPath = new URL(u).pathname; } catch { lastPath = u; }
    if (!/\/login(\b|$)/.test(lastPath)) {
      log(`URL a quitté /login -> session active (${lastPath})`);
      return { logged: true };
    }
    const elapsed = Date.now() - t0;
    if (elapsed > 0 && elapsed % step < 500) {
      log(`Observation: ${Math.floor(elapsed/1000)}s / ${Math.floor(detectTotal/1000)}s (toujours sur /login)`);
    }
    await sleep(500);
  }
  log('Observation terminée: toujours sur /login -> pas connecté');
  return { logged: false };
}

(async () => {
  const cfg = await loadConfig();
  // Logging: nouveau schéma (cfg.logging) avec compat ancienne clé
  LOG_MINIMAL = !!(cfg.logging?.minimal ?? cfg.minimalLogs);
  LOG_COLORED = !!(cfg.logging?.colored ?? cfg.coloredLogs);
  
  console.log(createSeparator('DÉMARRAGE SCRIPT BUMP', 'thick'));
  log(`${ICONS.progress} Initialisation du script`);
  console.log(createSeparator('', 'single'));

  // Utilitaires d'affichage / attente améliorés
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

  async function waitDelayWithProgress(totalMs, label = 'attente') {
    if (totalMs <= 0) return; // rien
    
    // Granularité dynamique
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
      
      if (totalMs >= 10 * 1000) { // éviter spam si très court
        const progress = Math.round((waited / totalMs) * 100);
        const progressBar = '█'.repeat(Math.floor(progress / 5)) + '░'.repeat(20 - Math.floor(progress / 5));
        log(`${ICONS.time} Progression ${label}: ${formatDelay(waited)} / ${formatDelay(totalMs)} [${progressBar}] ${progress}%`);
      }
    }
  }

  async function runAccount(accountCfg) {
    const sessionRoot = path.join(process.cwd(), 'sessions');
    try { await fs.mkdir(sessionRoot, { recursive: true }); } catch {}
    const sessionName = (accountCfg.sessionName || 'default-session').replace(/[^a-zA-Z0-9_-]/g, '_');
    const userDataDir = path.join(sessionRoot, sessionName);
    log(`[${sessionName}] Ouverture navigateur`);
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
      log(`${ICONS.browser} [${sessionName}] Accès initial page login`);
      await page.goto('https://discord.com/login', { waitUntil: 'domcontentloaded' });
      const detect = await detectExistingSession(page, accountCfg);
      if (!detect.logged) {
        await simpleLogin(page, accountCfg, { skipGoto: true, skipInitialWait: true });
      }
      await simpleBump(page, accountCfg);
      log(`${ICONS.success} [${sessionName}] Terminé.`);
    } catch (e) {
      console.error(`${ICONS.error} [${sessionName}] Erreur:`, e.message);
      if (accountCfg.webhookUrl) {
        await postWebhook(accountCfg.webhookUrl, { event: 'error', message: e.message || 'Erreur inconnue', _meta: { session: accountCfg.sessionName || sessionName } });
      }
    }
    const close = accountCfg.closeBrowserOnFinish !== false; // par défaut on ferme
    if (close) {
      try { await browser.close(); log(`${ICONS.success} [${sessionName}] Navigateur fermé (closeBrowserOnFinish).`); } catch {}
    } else {
      log(`${ICONS.info} [${sessionName}] Navigateur laissé ouvert (closeBrowserOnFinish=false).`);
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

  // Récapitulatif de la configuration de boucle & comptes
  log(`${ICONS.info} Boucle: ${loopEnabled ? 'activée' : 'désactivée'}`);
  log(`${ICONS.info} Comptes configurés: ${normalizedAccounts.length}`);
  if (normalizedAccounts.length) {
    const names = normalizedAccounts.map(a => a.sessionName || 'session').join(', ');
    log(`${ICONS.user} Sessions: ${names}`);
  }
  if (normalizedAccounts.length >= 2) {
    log(`${ICONS.time} Délai entre exécutions: ${formatDelay(delayMs)}`);
  }
  if (maxCycles) log(`${ICONS.info} Limite de cycles: ${maxCycles}`);

  if (!loopEnabled) {
    // Mode non bouclé: enchaîner les comptes une seule fois, avec attente entre chacun
    for (let i = 0; i < normalizedAccounts.length; i++) {
      const accCfg = { ...normalizedAccounts[i] };
      await runAccount(accCfg);
      const isLast = i === normalizedAccounts.length - 1;
      if (!isLast && delayMs > 0) {
        log(`${ICONS.time} Attente ${formatDelay(delayMs)} avant le prochain compte`);
        await waitDelayWithProgress(delayMs, 'avant prochain compte');
      }
    }
    console.log(createSeparator('TERMINÉ', 'thick'));
    log(`${ICONS.success} Tous les comptes traités (mode non bouclé).`);
  } else {
    let cycle = 1;
    while (true) {
      console.log(createSeparator(`CYCLE #${cycle}`, 'cycle'));
      log(`${ICONS.cycle} Début du cycle #${cycle}`);
      console.log(createSeparator('', 'single'));

      for (let i = 0; i < normalizedAccounts.length; i++) {
        const acc = normalizedAccounts[i];
        const accCfg = { ...acc, __currentCycle: cycle };
        log(`${ICONS.user} Compte ${i + 1}: ${accCfg.sessionName || 'session'}`);
        await runAccount(accCfg);
        // Attente uniforme entre chaque exécution, y compris avant de reboucler
        log(`${ICONS.time} Attente ${formatDelay(delayMs)} avant le prochain passage`);
        await waitDelayWithProgress(delayMs, `cycle ${cycle} → attente`);
      }

      console.log(createSeparator(`FIN CYCLE #${cycle}`, 'cycle'));
      cycle += 1;
      if (maxCycles && cycle > maxCycles) {
        console.log(createSeparator('TERMINÉ', 'thick'));
        log(`${ICONS.success} Nombre maximal de cycles atteint. Fin.`);
        break;
      }
    }
  }

  if (!loopEnabled) {
    if (cfg.keepAliveMs && cfg.keepAliveMs > 0) {
      log(`[keepAlive] Maintien du processus ouvert pendant ${formatDelay(cfg.keepAliveMs)} (les navigateurs resteront ouverts).`);
      await sleep(cfg.keepAliveMs);
      log('[keepAlive] Fin de la période de maintien.');
    }
  }
})();
