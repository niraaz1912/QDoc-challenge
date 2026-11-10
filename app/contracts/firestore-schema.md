1️⃣ users

users/{uid}
  uid: string
  email: string
  createdAt: timestamp
  role: "PATIENT" | "CLINIC"
  defaultProfileId: string   // points to their main profile

2️⃣ profiles (family members)

profiles/{profileId}
  userId: string              // owner uid
  isPrimary: boolean          // true for the signup person
  firstName: string
  lastName: string

  // Demographics
  dateOfBirth: string         // "YYYY-MM-DD"
  gender: "MALE" | "FEMALE" | "OTHER" | "PREFER_NOT_TO_SAY"
  postalCode: string          // e.g., "R3T 2N2"
  province: string            // optional (can be derived from postal)
  preferredLanguage: string   // optional, e.g., "en"

  // Health / risk
  chronicConditions: string[] // e.g., ["ASTHMA", "DIABETES"]
  riskTags: string[]          // e.g., ["PREGNANT", "IMMUNOCOMPROMISED"]

  //Family members
  familymMembers : string[] // eg : userID of family members.

  createdAt: timestamp
  updatedAt: timestamp


3️⃣ vaccineRecords

vaccineRecords/{recordId}
  profileId: string
  vaccineKey: string
  dateAdministered: string
  doseNumber: number
  source: "SELF_REPORTED" | "CLINIC"   // helpful later
  createdAt: timestamp

4️⃣ reminders

reminders/{reminderId}

profileId: string
vaccineKey: string
dueDate: string (ISO)
status: "ACTIVE" | "COMPLETED"
createdAt: timestamp

5️⃣ clinics

clinics/{clinicId}

name: string
address: string
latitude: number
longitude: number
phone: string


6️⃣ optional: outreachLogs (clinic dashboard)

outreachLogs/{logId}

profileId: string
vaccineKey: string
contactMethod: "EMAIL"
createdAt: timestamp




