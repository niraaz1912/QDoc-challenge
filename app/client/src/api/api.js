import { auth } from "../firebase.js";

const BASE_URL =
  import.meta.env.VITE_API_BASE_URL || "";

async function request(path, { method = "GET", body } = {}) {
  const token = await auth.currentUser?.getIdToken();
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `Request failed: ${res.status}`);
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
