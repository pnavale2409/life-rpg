import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

// All values come from your .env.local file (never committed to git).
// See .env.example for the full list and README.md for where to find these
// in the Firebase console.
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

console.log("Firebase config", firebaseConfig);

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);

// The Firestore collection your quest data lives in. Each document is
// keyed by the secret code the user enters, so any device that enters
// the same code reads/writes the same document.
export const QUESTS_COLLECTION = "quests";
