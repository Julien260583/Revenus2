# Lodgify Revenue Dashboard — Vercel

## Structure

```
/
├── api/
│   └── reservations.js   ← Serverless function (appelle Lodgify)
├── public/
│   └── index.html        ← Dashboard frontend
├── vercel.json           ← Config routage Vercel
└── package.json
```

## Déploiement sur Vercel

### 1. Pusher sur GitHub
```bash
git init
git add .
git commit -m "init"
git remote add origin https://github.com/VOTRE_USER/lodgify-dashboard.git
git push -u origin main
```

### 2. Importer sur Vercel
- Aller sur [vercel.com](https://vercel.com) → **Add New Project**
- Importer votre repo GitHub

### 3. Ajouter la variable d'environnement
Dans **Settings → Environment Variables** :

| Name | Value |
|------|-------|
| `LODGIFY_API_KEY` | `votre_clé_api_lodgify` |

> ⚠️ Cocher les 3 environnements : Production, Preview, Development

### 4. Déployer
Cliquer **Deploy** — c'est tout !

## Développement local
```bash
npm install -g vercel
vercel dev
```
La variable sera lue depuis `.env.local` :
```
LODGIFY_API_KEY=votre_clé
```
