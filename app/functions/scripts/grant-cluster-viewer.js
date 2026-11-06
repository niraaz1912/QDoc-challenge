import { applicationDefault, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";

const account = process.argv[2];
if (!account || !process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  console.error("Usage: set GOOGLE_APPLICATION_CREDENTIALS to a local service-account JSON path, then run node scripts/grant-cluster-viewer.js <email-or-uid>");
  process.exit(1);
}

initializeApp({ credential: applicationDefault() });
const auth = getAuth();
const user = account.includes("@") ? await auth.getUserByEmail(account) : await auth.getUser(account);
await auth.setCustomUserClaims(user.uid, { ...user.customClaims, clusterViewer: true });
console.log(`Granted clusterViewer to Firebase UID ${user.uid}. Sign out and back in to refresh the token.`);
