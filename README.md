<div align="center">

# ⚡ Discord Bump Automatisé

Automatisez proprement vos bumps Discord, en alternant plusieurs comptes avec une temporisation configurable.

</div>

---

## Points forts

- Alternance multi‑comptes avec un délai unique et clair (ex: 1h)
- Persistance de session par compte (profil séparé par `sessionName`)
- Détection de session active pour éviter un re‑login inutile
- Envoi de 2 bumps consécutifs par passage
- Sécurité « 24h » appliquée automatiquement (panneau + sauvegarde), avec:
  - Notification webhook (embed)
  - Message envoyé dans le salon quand c’est confirmé
- Logs lisibles (horodatés), option mode minimal/couleurs

> Remarque: L’automatisation peut être contraire aux CGU de Discord/du bot ciblé. Utilisez à vos risques.

---

## Installation rapide

```bash
npm install
npm start
```

Node 18+ recommandé.

---

## Configuration (v2)

Fichier `config.json` minimal et sans commentaires:

```json
{
  "logging": { "minimal": false, "colored": false },
  "loop": { "enabled": true, "delayMs": 3600000, "maxCycles": null },
  "messages": { "securityActivated": { "text": "Sécurité 24h activée ✅" } },
  "accounts": [
    {
      "email": "user1@example.com",
      "password": "pass1",
      "sessionName": "compte-A",
      "channelUrl": "https://discord.com/channels/<guild>/<chan>",
      "webhookUrl": "https://discord.com/api/webhooks/...",
      "enableSecurityAction": true
    },
    {
      "email": "user2@example.com",
      "password": "pass2",
      "sessionName": "compte-B",
      "channelUrl": "https://discord.com/channels/<guild>/<chan>",
      "webhookUrl": "https://discord.com/api/webhooks/...",
      "enableSecurityAction": true
    }
  ]
}
```

- `loop.delayMs`: délai unique entre les passages (ex: `3600000` = 1h; pour tester, utilisez `8000`).
- `messages.securityActivated.text`: message envoyé dans le salon quand la sécurité 24h est confirmée.

---

## Comment ça s’enchaîne

```text
for (cycle = 1..∞) {
  for (account of accounts) {
    runAccount(account);
    wait(delayMs);
  }
}
```

Chaque passage:
1) Ouvre le navigateur avec le profil du compte
2) Vérifie si la session est déjà active (sinon login simple)
3) Va sur le salon et envoie 2× `/bump`
4) Applique/Confirme « 24h » si activé (webhook + message salon)
5) Ferme le navigateur (par défaut)

---

## Personnalisation

- Mode logs minimal/couleur: `logging.minimal`, `logging.colored`
- Message de confirmation sécurité: `messages.securityActivated.text`
- Nombre de cycles: `loop.maxCycles` (ex: `5`), ou `null` pour infini
- Ajoutez d’autres comptes en étendant le tableau `accounts`

---

## Dépannage rapide

- Si rien ne s’écrit dans le salon: vérifier le focus de la zone d’entrée
- Si login/relogin en boucle: supprimer le dossier `sessions/<sessionName>` du compte concerné puis relancer
- Si Discord change ses sélecteurs: il faudra ajuster les sélecteurs d’entrée/boutons
- Vérifier les logs de démarrage: liste des sessions, statut boucle, délai affiché

### Puppeteer: Failed to launch the browser process

Si vous voyez une erreur du type:

```
Error: Failed to launch the browser process!
.../chrome-linux64/chrome: 1: Syntax error: "(" unexpected
```

Causes et solutions:

- WSL/Linux sans binaire compatible: le Chrome téléchargé par Puppeteer (Linux) ne peut pas s’exécuter dans votre environnement. Le script détecte Windows/WSL et tente automatiquement:
  - d’utiliser `PUPPETEER_EXECUTABLE_PATH` si défini,
  - sinon le binaire téléchargé par Puppeteer,
  - sinon une installation locale (Chrome/Edge) sur Windows.

- Variables utiles:
  - `PUPPETEER_EXECUTABLE_PATH`: chemin complet vers chrome/chromium/msedge.
  - `PUPPETEER_CACHE_DIR`: répertoire de cache Puppeteer si vous voulez persister ailleurs.

- Sous Linux/WSL sans serveur X (pas de DISPLAY), le script force `headless: "new"`. Pour afficher l’UI, lancez avec un DISPLAY actif ou définissez `headless: false` dans `config.json` (par compte).

- Windows: assurez-vous que Chrome ou Edge est installé. Le script cherchera automatiquement dans Program Files/LocalAppData.

Exemple PowerShell pour forcer un chemin:

```powershell
$env:PUPPETEER_EXECUTABLE_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"; npm start
```

---

## Licence

Usage personnel uniquement. Aucune garantie.

