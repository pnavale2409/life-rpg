# Quest Log

A personal 91-day quest tracker (Wisdom / Vitality / Wealth / Resolve), backed by
Firebase Firestore so your data follows you across devices, and deployable as a
static site on GitHub Pages.

There's no real login — instead, you pick a **secret code**. Enter the same
code on any device/browser and you'll see the same data. This is simple by
design, but it means anyone who has both your code *and* your Firebase config
could read/write that document — see **Security notes** below before you rely
on this for anything sensitive.

---

## 1. Create a Firebase project

1. Go to [console.firebase.google.com](https://console.firebase.google.com) → **Add project** → give it any name → finish the wizard (Google Analytics is optional, you can skip it).
2. In the left sidebar, go to **Build → Firestore Database** → **Create database** → start in **production mode** → pick any region close to you.
3. Once created, go to **Project settings** (gear icon, top left) → scroll to **Your apps** → click the **</>** (web) icon → give the app a nickname → **Register app**. You don't need Firebase Hosting for this step.
4. Firebase will show you a `firebaseConfig` object with keys like `apiKey`, `authDomain`, `projectId`, etc. Keep this tab open — you'll need these values in step 3 below.

### Set Firestore security rules

Go to **Firestore Database → Rules** and replace the contents with:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /quests/{code} {
      allow read, write: if true;
    }
  }
}
```

Click **Publish**. (See the security note at the bottom — this rule trusts
whoever knows a document's code, nothing more.)

---

## 2. Get the code running locally

You'll need [Node.js](https://nodejs.org) 18+ installed.

```bash
npm install
cp .env.example .env.local
```

Open `.env.local` and paste in the values from your `firebaseConfig` (step 1.4):

```
VITE_FIREBASE_API_KEY=AIza...
VITE_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=your-project
VITE_FIREBASE_STORAGE_BUCKET=your-project.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=123456789
VITE_FIREBASE_APP_ID=1:123456789:web:abcdef
```

Then run it:

```bash
npm run dev
```

Open the printed `localhost` URL. The first time, you'll be asked to create a
secret code — pick something long and hard to guess (this is your only
"password"). Use the exact same code on your phone/laptop/etc. to see the same
data everywhere.

---

## 3. Push to GitHub

```bash
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/<your-username>/<your-repo>.git
git push -u origin main
```

`.env.local` is in `.gitignore`, so your Firebase keys won't be committed —
good practice even though Firebase web API keys aren't secret in the way
server-side keys are.

### Update the base path

Open `vite.config.js` and set `base` to match your repo name exactly, e.g. if
your repo is `github.com/yourname/life-rpg`:

```js
base: "/life-rpg/",
```

(If you're deploying to a *user/org* page repo named `<username>.github.io`,
set `base: "/"` instead.)

---

## 4. Deploy to GitHub Pages

This repo includes a GitHub Actions workflow (`.github/workflows/deploy.yml`)
that builds and deploys automatically on every push to `main`.

1. In your GitHub repo, go to **Settings → Pages** → under **Build and
   deployment**, set **Source** to **GitHub Actions**.
2. Go to **Settings → Secrets and variables → Actions → New repository
   secret**, and add each of these (same values as your `.env.local`):
   - `VITE_FIREBASE_API_KEY`
   - `VITE_FIREBASE_AUTH_DOMAIN`
   - `VITE_FIREBASE_PROJECT_ID`
   - `VITE_FIREBASE_STORAGE_BUCKET`
   - `VITE_FIREBASE_MESSAGING_SENDER_ID`
   - `VITE_FIREBASE_APP_ID`
3. Push to `main` (or re-run the workflow from the **Actions** tab). Once it
   finishes, your app will be live at:
   `https://<your-username>.github.io/<your-repo>/`

---

## Security notes

- The "secret code" model is **obscurity, not real security**. Firestore
  rules here allow anyone who both (a) knows your Firebase project's public
  config (visible in any deployed site's JS bundle — this is normal for
  Firebase) and (b) guesses or is given your exact code, to read/write that
  one document. They cannot browse or list other codes without already
  knowing them.
- Use a long, random code (e.g. `mix-of-words-and-numbers-2847`), not
  something guessable like your name or "test".
- If you ever want real per-user security, the next step up is adding Firebase
  Authentication (Google or email/password sign-in) and rules like
  `allow read, write: if request.auth.uid == userId;` — ask me any time and
  I can wire that in instead.

## Project structure

```
src/
  App.jsx       – the whole app (all tabs, scoring, Firestore sync)
  firebase.js   – Firebase/Firestore initialization
  main.jsx      – React entry point
  index.css     – Tailwind
```
