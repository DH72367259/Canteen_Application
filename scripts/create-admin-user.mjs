import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";

function readArg(name) {
  const prefix = `${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length) : undefined;
}

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing env variable: ${name}`);
  }
  return value;
}

async function main() {
  const email = readArg("--email");
  const password = readArg("--password");

  if (!email || !password) {
    throw new Error("Usage: node scripts/create-admin-user.mjs --email=admin@example.com --password=StrongPass123!");
  }

  if (getApps().length === 0) {
    initializeApp({
      credential: cert({
        projectId: requiredEnv("FIREBASE_PROJECT_ID"),
        clientEmail: requiredEnv("FIREBASE_CLIENT_EMAIL"),
        privateKey: requiredEnv("FIREBASE_PRIVATE_KEY").replace(/\\n/g, "\n"),
      }),
    });
  }

  const auth = getAuth();
  const user = await auth.createUser({
    email,
    password,
    emailVerified: true,
  });

  await auth.setCustomUserClaims(user.uid, { admin: true });
  console.log(`Created admin user: ${email} (${user.uid})`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
