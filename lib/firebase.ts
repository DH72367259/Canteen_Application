// Client-side Firebase exports
export { isFirebaseClientConfigured } from "./firebaseClient";

// Import and export getAuth and other functions
import { getClientAuth } from "./firebaseClient";
import { getFirestore, type Firestore } from "firebase/firestore";
import { getApps, initializeApp } from "firebase/app";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

let db: Firestore | null = null;

export function getDatabase() {
  if (typeof window === "undefined") {
    throw new Error("Firestore is only available in the browser.");
  }

  if (db) {
    return db;
  }

  const app =
    getApps().length > 0 ? getApps()[0] : initializeApp(firebaseConfig);
  db = getFirestore(app);
  return db;
}

// For backward compatibility
export { getClientAuth };
