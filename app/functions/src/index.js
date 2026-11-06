import "dotenv/config";
import * as functions from "firebase-functions";
import express from "express";
import cors from "cors";
import { GoogleGenAI } from "@google/genai";
import { applicationDefault, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";

const app = express();
export { app };

const requestCounts = new Map();
app.use((req, res, next) => {
  if (req.path === "/metrics") return next();
  res.on("finish", () => {
    const key = `${req.method}|${req.route?.path || "unmatched"}|${res.statusCode}`;
    requestCounts.set(key, (requestCounts.get(key) || 0) + 1);
  });
  next();
});

app.get("/health", (_req, res) => res.json({ status: "ok" }));
app.get("/metrics", (_req, res) => {
  const lines = ["# HELP qdoc_http_requests_total HTTP requests handled by the backend.", "# TYPE qdoc_http_requests_total counter"];
  for (const [key, count] of requestCounts) {
    const [method, route, status] = key.split("|");
    const safeRoute = route.replace(/[^a-zA-Z0-9_/:.-]/g, "_");
    lines.push(`qdoc_http_requests_total{method="${method}",route="${safeRoute}",status="${status}"} ${count}`);
  }
  res.type("text/plain; version=0.0.4").send(`${lines.join("\n")}\n`);
});

// --- Simple in-memory conversation memory (per authenticated user) ---
// NOTE: This resets when the functions instance restarts. For persistent memory, store in Firestore.
const conversations = new Map(); // uid -> [{ role: "user"|"model", parts: [{text:string}] }]

function clampArray(arr, max) {
  if (!Array.isArray(arr)) return [];
  return arr.length > max ? arr.slice(arr.length - max) : arr;
}

// Build a comprehensive summary so the AI knows the full patient context.
function summarizeContext(context) {
  const profile = context?.profile ?? {};
  const nestedProfile = profile?.profile ?? {};
  const reminderPrefs = profile?.reminderPrefs ?? {};

  const eligibility = context?.eligibility ?? {};

  const result = Array.isArray(eligibility?.result)
    ? eligibility.result
    : (Array.isArray(context?.result) ? context.result : []);

  // Expand the picked fields to include reasons, taken doses, etc.
  const pick = (r) => ({
    displayName: r?.displayName ?? r?.vaccineKey ?? "Unknown",
    status: r?.status ?? null,
    dueDate: r?.dueDate ?? null,
    nextDoseNumber: r?.nextDoseNumber ?? null,
    requiredDoses: r?.requiredDoses ?? null,
    remainingDoses: r?.remainingDoses ?? null,
    takenDoses: r?.takenDoses ?? 0,
    reasons: r?.reasons ?? [], // Crucial so the AI knows exactly WHY they are eligible/ineligible
  });

  // Map all states without severely truncating them so the AI has the full picture
  const overdue = result.filter((r) => r?.status === "OVERDUE").map(pick);
  const dueSoon = result.filter((r) => r?.status === "DUE_SOON").map(pick);
  const notEligible = result.filter((r) => r?.status === "NOT_ELIGIBLE").map(pick);

  return {
    profile: {
      displayName: profile?.displayName || nestedProfile?.patientName || "Guest",
      email: profile?.email ?? null,
      gender: nestedProfile?.gender ?? null,
      dob: nestedProfile?.dateOfBirth ?? null,
      phone: nestedProfile?.phoneNumber ?? null,
      chronicDiseases: nestedProfile?.chronicDiseases ?? [],
      vaccinationHistory: nestedProfile?.vaccinationHistory ?? [],
    },
    reminderPreferences: {
      emailEnabled: reminderPrefs?.emailEnabled ?? false,
      smsEnabled: reminderPrefs?.smsEnabled ?? false,
    },
    eligibility: {
      uid: eligibility?.uid ?? null,
    },
    vaccineSummary: {
      overdue,
      dueSoon,
      notEligible,
      totals: {
        totalRules: result.length,
        overdue: overdue.length,
        dueSoon: dueSoon.length,
        notEligible: notEligible.length,
      },
    },
  };
}

app.use(express.json());
app.use(
  cors({
    origin: ["http://localhost:5173"],
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

async function requireFirebaseUser(req, res, next) {
  const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
  if (!token) return res.status(401).json({ error: "Authentication required" });
  try {
    if (!getApps().length) {
      initializeApp({
        credential: applicationDefault(),
        projectId: process.env.FIREBASE_PROJECT_ID || process.env.GCLOUD_PROJECT,
      });
    }
    req.firebaseUser = await getAuth().verifyIdToken(token);
    next();
  } catch {
    return res.status(401).json({ error: "Invalid authentication token" });
  }
}

app.post("/chat", requireFirebaseUser, async (req, res) => {
  try {
    const { question, context } = req.body || {};
    if (!question) return res.status(400).json({ error: "Missing question" });

    const apiKey = process.env.GEMINI_API_KEY;
    const model = process.env.GEMINI_MODEL || "gemini-2.0-flash";
    if (!apiKey) return res.status(500).json({ error: "Missing GEMINI_API_KEY" });

    const ai = new GoogleGenAI({ apiKey });

    const key = req.firebaseUser.uid;
    const history = conversations.get(key) || [];

    const contextSummary = summarizeContext(context);

    const systemInstruction = `You are a vaccination assistant inside a web app.

CRITICAL INSTRUCTIONS:
- You HAVE been securely provided with the patient's actual medical and vaccination records in the "Patient Context" JSON below. 
- You MUST use this JSON data to answer the user's questions about their history, past vaccines, upcoming doses, and eligibility. 
- Do NOT say you lack access to their records, because the records are explicitly provided to you right here.

Your job:
- Answer the user's questions accurately using ONLY the provided patient context and chat history.
- Be concise, clear, and practical.
- If the user asks for new medical diagnoses or advice outside of this context, then you may suggest talking to a clinician/pharmacist.
- Do NOT invent vaccine records or clinic policies. 

Patient Context:
${JSON.stringify(contextSummary, null, 2)}`;

    const patientContextMsg = {
  role: "user",
  parts: [{ text: `PATIENT CONTEXT JSON:\n${JSON.stringify(contextSummary, null, 2)}` }],
};

    // Gemini's @google/genai uses "user" and "model" roles in contents.
    const contents = [
      patientContextMsg,
      ...clampArray(history, 20),
      { role: "user", parts: [{ text: String(question) }] },
    ];

    const response = await ai.models.generateContent({
      model,
      contents,
      config: {
        systemInstruction, // string is allowed
      },
    });

    const answer =
      response.text ??
      response.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") ??
      "I couldn't generate a response. Please try again.";

    // Update memory
    const updated = clampArray(
      [
        ...history,
        { role: "user", parts: [{ text: String(question) }] },
        { role: "model", parts: [{ text: String(answer) }] },
      ],
      20
    );
    conversations.set(key, updated);

    return res.json({ answer });
  } catch (err) {
    console.error("Chat error:", err);
    return res.status(500).json({ error: err?.message || "Unknown error" });
  }
});

export const api = functions.https.onRequest(app);
