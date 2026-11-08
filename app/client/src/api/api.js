import { auth } from "../firebase.js";

const BASE_URL =
  import.meta.env.VITE_API_BASE_URL || "";

async function request(path, { method = "GET", body } = {}) {
  const token = await auth.currentUser?.getIdToken();
  let res;
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined
    });
  } catch {
    throw new Error("Could not reach the assistant. Check your connection and try again.");
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    let message;
    try { message = JSON.parse(text).error; } catch { /* Non-JSON response. */ }
    if (res.status === 401) message = "Your session has expired. Please sign out and back in.";
    throw new Error(message || `Request failed: ${res.status}`);
  }

  return res.json();
}

export const api = {
  chat: (profileId, question, context) =>
    request(`/chat`, {
      method: "POST",
      body: { profileId, question, context }
    })
};
