const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CALENDAR_CLIENT_ID;
const GOOGLE_SCOPE = "https://www.googleapis.com/auth/calendar.events";

let googleScriptPromise;
let tokenClient;
let accessToken = "";

function loadGoogleIdentityScript() {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("Google Calendar sync is only available in the browser."));
  }

  if (window.google?.accounts?.oauth2) {
    return Promise.resolve();
  }

  if (googleScriptPromise) return googleScriptPromise;

  googleScriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Failed to load Google Identity script."));
    document.head.appendChild(script);
  });

  return googleScriptPromise;
}

function getTokenClient() {
  if (!GOOGLE_CLIENT_ID) {
    throw new Error(
      "Missing Google Calendar client ID. Set VITE_GOOGLE_CALENDAR_CLIENT_ID in app/client/.env locally or in GitHub Actions repository variables for deployment, then rebuild the frontend."
    );
  }

  if (!window.google?.accounts?.oauth2) {
    throw new Error("Google Identity Services is not available.");
  }

  if (!tokenClient) {
    tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: GOOGLE_SCOPE,
      callback: () => {},
    });
  }

  return tokenClient;
}

function requestAccessToken() {
  return new Promise((resolve, reject) => {
    const client = getTokenClient();

    client.error_callback = (response) => {
      reject(new Error(response?.type || "Google authorization failed."));
    };

    client.callback = (response) => {
      if (!response || response.error) {
        reject(new Error(response?.error || "Google authorization failed."));
        return;
      }

      accessToken = response.access_token || "";
      if (!accessToken) {
        reject(new Error("Google authorization did not return an access token."));
        return;
      }

      resolve(accessToken);
    };

    client.requestAccessToken({ prompt: accessToken ? "" : "consent" });
  });
}

function toDateOnly(value) {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function plusOneDay(dateOnly) {
  const date = new Date(`${dateOnly}T00:00:00`);
  if (Number.isNaN(date.getTime())) return null;
  date.setDate(date.getDate() + 1);
  return date.toISOString().slice(0, 10);
}

function buildEvent(vaccine) {
  const dueDate = toDateOnly(vaccine?.dueDate);
  if (!dueDate) return null;

  const endDate = plusOneDay(dueDate);
  if (!endDate) return null;

  return {
    summary: `Vaccine due: ${vaccine.name}`,
    description:
      `Upcoming vaccine reminder from VaxTrack.\n\n` +
      `Vaccine: ${vaccine.name}\n` +
      `Status: ${vaccine.status}\n` +
      `Due date: ${dueDate}`,
    start: { date: dueDate },
    end: { date: endDate },
    reminders: {
      useDefault: false,
      overrides: [
        { method: "popup", minutes: 24 * 60 },
        { method: "popup", minutes: 60 },
      ],
    },
  };
}

async function insertPrimaryCalendarEvent(event, token) {
  const response = await fetch(
    "https://www.googleapis.com/calendar/v3/calendars/primary/events",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(event),
    }
  );

  if (!response.ok) {
    const body = await response.text();
    throw new Error(body || "Google Calendar API request failed.");
  }
}

export async function syncVaccinesToGoogleCalendar(vaccines = []) {
  await loadGoogleIdentityScript();
  const token = await requestAccessToken();

  const created = [];
  const failed = [];

  for (const vaccine of vaccines) {
    const event = buildEvent(vaccine);
    if (!event) {
      failed.push({
        name: vaccine?.name || "Unknown vaccine",
        reason: "Missing or invalid due date.",
      });
      continue;
    }

    try {
      await insertPrimaryCalendarEvent(event, token);
      created.push(vaccine.name);
    } catch (error) {
      failed.push({
        name: vaccine?.name || "Unknown vaccine",
        reason: error?.message || "Unknown error",
      });
    }
  }

  return { created, failed };
}
