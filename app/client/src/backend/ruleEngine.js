/*******************************
 * STEP 1 — preprocessRuleSet(ruleSet)
 *
 * Goals:
 *  - Build rulesByKey (fast lookup by vaccineKey)
 *  - Sort clauses by priority ASC (deterministic)
 *  - Ensure safe defaults (clauses[], aliasesForDoseCounting[], series{})
 *  - Add deterministic tie-breakers (priority -> clauseId -> original order)
 *******************************/

function preprocessRuleSet(ruleSet) {
  if (!ruleSet || typeof ruleSet !== "object") {
    throw new Error("preprocessRuleSet: ruleSet must be an object");
  }

  const dueSoonWindowDays =
    Number.isFinite(ruleSet.dueSoonWindowDays) ? ruleSet.dueSoonWindowDays : 30;

  const rawRules = Array.isArray(ruleSet.vaccineRules) ? ruleSet.vaccineRules : [];
  if (!Array.isArray(ruleSet.vaccineRules)) {
    console.warn("preprocessRuleSet: ruleSet.vaccineRules was not an array; defaulting to []");
  }

  const rulesByKey = Object.create(null);
  const processedRules = [];

  for (let i = 0; i < rawRules.length; i++) {
    const raw = rawRules[i];
    if (!raw || typeof raw !== "object") continue;

    const vaccineKey = String(raw.vaccineKey || "").trim();
    if (!vaccineKey) {
      console.warn(`preprocessRuleSet: skipping rule at index ${i} (missing vaccineKey)`);
      continue;
    }

    if (rulesByKey[vaccineKey]) {
      throw new Error(`preprocessRuleSet: duplicate vaccineKey "${vaccineKey}"`);
    }

    // Safe defaults
    const aliasesForDoseCounting = Array.isArray(raw.aliasesForDoseCounting)
      ? raw.aliasesForDoseCounting.map(String)
      : [];

    const series =
      raw.series && typeof raw.series === "object" && !Array.isArray(raw.series)
        ? { ...raw.series }
        : {};

    const rawClauses = Array.isArray(raw.clauses) ? raw.clauses : [];
    const clauses = rawClauses
      .map((c, idx) => {
        if (!c || typeof c !== "object") return null;

        const clauseId = String(c.clauseId || "").trim();
        // If clauseId missing, still allow, but make deterministic and debuggable
        const safeClauseId = clauseId || `${vaccineKey}__clause_${idx}`;

        const priority = Number.isFinite(c.priority) ? c.priority : 999999;

        // Normalize tag arrays (if present)
        const requireRiskTagsAny = Array.isArray(c.requireRiskTagsAny)
          ? c.requireRiskTagsAny.map(String)
          : undefined;

        const forbidRiskTagsAny = Array.isArray(c.forbidRiskTagsAny)
          ? c.forbidRiskTagsAny.map(String)
          : undefined;

        const reasons = Array.isArray(c.reasons) ? c.reasons.map(String) : [];

        // Keep everything else as-is (age bounds, birthYearMin/Max, etc.)
        return {
          ...c,
          clauseId: safeClauseId,
          priority,
          ...(requireRiskTagsAny ? { requireRiskTagsAny } : {}),
          ...(forbidRiskTagsAny ? { forbidRiskTagsAny } : {}),
          reasons,
          __order: idx // tie-breaker to keep sorting stable
        };
      })
      .filter(Boolean);

    // Deterministic sort: priority ASC, then clauseId ASC, then original order
    clauses.sort((a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority;
      if (a.clauseId !== b.clauseId) return a.clauseId < b.clauseId ? -1 : 1;
      return a.__order - b.__order;
    });

    // Remove private sort helper before returning (optional)
    const finalizedClauses = clauses.map((clause) => {
      const finalized = { ...clause };
      delete finalized.__order;
      return finalized;
    });

    const processed = {
      ...raw,
      vaccineKey,
      aliasesForDoseCounting,
      series,
      clauses: finalizedClauses
    };

    rulesByKey[vaccineKey] = processed;
    processedRules.push(processed);
  }

  return {
    ...ruleSet,
    dueSoonWindowDays,
    vaccineRules: processedRules,
    rulesByKey
  };
}


/*******************************
 * STEP 2 — normalizeProfile(profile, asOfISO)
 *
 * Goal:
 *  - Take the raw DB profile shape and normalize it into an engine-friendly shape.
 *  - Compute ages (years, months, weeks) deterministically.
 *  - Convert chronicConditions & riskTags into Sets for fast checking.
 *  - Normalize vaccinationHistory into a clean, sorted array of { vaccineKey, dateISO }.
 *
 * IMPORTANT:
 *  - We treat dates as "date-only" (YYYY-MM-DD) to avoid timezone bugs.
 *******************************/

/** Parse "YYYY-MM-DD" into a Date at UTC midnight (safe for date-only math). */
function parseISODateOnly(iso) {
  if (typeof iso !== "string") return null;
  const m = iso.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  // validate round-trip
  if (
    dt.getUTCFullYear() !== y ||
    dt.getUTCMonth() !== mo - 1 ||
    dt.getUTCDate() !== d
  ) return null;
  return dt;
}

function formatISODateOnly(dt) {
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const d = String(dt.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Returns whole-day difference: (b - a) in days. */
function diffDaysUTC(a, b) {
  const MS = 24 * 60 * 60 * 1000;
  return Math.floor((b.getTime() - a.getTime()) / MS);
}

/** Compute integer age in years as of asOfDate (date-only). */
function computeAgeYears(dobUTC, asOfUTC) {
  let years = asOfUTC.getUTCFullYear() - dobUTC.getUTCFullYear();
  const asOfMonth = asOfUTC.getUTCMonth();
  const dobMonth = dobUTC.getUTCMonth();
  if (
    asOfMonth < dobMonth ||
    (asOfMonth === dobMonth && asOfUTC.getUTCDate() < dobUTC.getUTCDate())
  ) {
    years -= 1;
  }
  return years;
}

/** Compute age in months (integer, floor) as of asOfDate. */
function computeAgeMonths(dobUTC, asOfUTC) {
  let months =
    (asOfUTC.getUTCFullYear() - dobUTC.getUTCFullYear()) * 12 +
    (asOfUTC.getUTCMonth() - dobUTC.getUTCMonth());
  if (asOfUTC.getUTCDate() < dobUTC.getUTCDate()) {
    months -= 1;
  }
  return months;
}

function normalizeProfile(profile, asOfISO) {
  if (!profile || typeof profile !== "object") {
    throw new Error("normalizeProfile: profile must be an object");
  }

  const asOfDate = parseISODateOnly(asOfISO);
  if (!asOfDate) {
    throw new Error("normalizeProfile: asOfISO must be YYYY-MM-DD");
  }

  const dob = parseISODateOnly(profile.dateOfBirth);
  if (!dob) {
    throw new Error("normalizeProfile: profile.dateOfBirth must be YYYY-MM-DD");
  }

  const chronicConditions = Array.isArray(profile.chronicConditions)
    ? profile.chronicConditions.map(String)
    : [];
  const riskTags = Array.isArray(profile.riskTags)
    ? profile.riskTags.map(String)
    : [];

  // Normalize vaccinationHistory -> [{ vaccineKey, dateISO }]
  // Acceptable input formats:
  //  - [{ vaccineKey: "HPV", date: "2025-01-10" }, ...]
  //  - [{ vaccineKey: "HPV", timestamp: "2025-01-10" }, ...]  (optional)
  //  - OR ignore invalid entries safely.
  const rawHist = Array.isArray(profile.vaccinationHistory)
    ? profile.vaccinationHistory
    : [];

  const history = [];
  for (const entry of rawHist) {
    if (!entry || typeof entry !== "object") continue;
    const vaccineKey = String(entry.vaccineKey || entry.vaccine || "").trim();
    const dateISO = String(entry.date || entry.timestamp || "").trim();
    if (!vaccineKey) continue;
    const dt = parseISODateOnly(dateISO);
    if (!dt) continue;
    history.push({ vaccineKey, dateISO: formatISODateOnly(dt) });
  }

  // Sort by date ascending for consistency
  history.sort((a, b) => (a.dateISO < b.dateISO ? -1 : a.dateISO > b.dateISO ? 1 : 0));

  const ageYears = computeAgeYears(dob, asOfDate);
  const ageMonths = computeAgeMonths(dob, asOfDate);
  const ageWeeks = Math.floor(diffDaysUTC(dob, asOfDate) / 7);

  // Build normalized engine object
  return {
    // Keep reference IDs if present (optional)
    userId: profile.userId ?? null,
    isPrimary: Boolean(profile.isPrimary),
    firstName: profile.firstName ?? "",
    lastName: profile.lastName ?? "",

    // Raw demographics
    dateOfBirthISO: formatISODateOnly(dob),
    gender: profile.gender ?? "PREFER_NOT_TO_SAY",
    postalCode: profile.postalCode ?? "",

    // Derived time
    asOfISO: formatISODateOnly(asOfDate),
    ageYears,
    ageMonths,
    ageWeeks,
    birthYear: dob.getUTCFullYear(),

    // Fast lookup sets
    chronicConditionsSet: new Set(chronicConditions),
    riskTagsSet: new Set(riskTags),

    // Clean history
    history
  };
}

/*******************************
 * STEP 3 — buildDoseIndex(p, preprocessedRuleSet)
 *
 * Goal:
 *  - For every vaccine in the ruleset, compute:
 *      counts[vaccineKey]  = number of doses found in history
 *      lastDate[vaccineKey]= most recent dose date (YYYY-MM-DD) or null
 *  - Respect aliasesForDoseCounting (e.g., MMRV counts toward MMR + VAR, etc.)
 *
 * Input:
 *  - p: normalized profile returned by normalizeProfile()
 *  - pre: output returned by preprocessRuleSet()
 *
 * Output:
 *  {
 *    counts: { [vaccineKey]: number },
 *    lastDate: { [vaccineKey]: "YYYY-MM-DD" | null }
 *  }
 *******************************/

function buildDoseIndex(p, pre) {
  if (!p || typeof p !== "object") throw new Error("buildDoseIndex: p must be an object");
  if (!pre || typeof pre !== "object") throw new Error("buildDoseIndex: pre must be an object");
  if (!pre.rulesByKey || typeof pre.rulesByKey !== "object") {
    throw new Error("buildDoseIndex: pre.rulesByKey missing. Did you run preprocessRuleSet?");
  }

  const history = Array.isArray(p.history) ? p.history : [];

  const counts = Object.create(null);
  const lastDate = Object.create(null);

  // Pre-init to guarantee keys exist for every vaccine in rules
  for (const vaccineKey of Object.keys(pre.rulesByKey)) {
    counts[vaccineKey] = 0;
    lastDate[vaccineKey] = null;
  }

  // Helper: given rule, build set of keys that should count toward it
  // (vaccineKey + aliases)
  for (const vaccineKey of Object.keys(pre.rulesByKey)) {
    const rule = pre.rulesByKey[vaccineKey];
    const countKeys = new Set([vaccineKey]);

    const aliases = Array.isArray(rule.aliasesForDoseCounting)
      ? rule.aliasesForDoseCounting
      : [];

    for (const a of aliases) {
      const key = String(a || "").trim();
      if (key) countKeys.add(key);
    }

    // Count and find last date among history for these keys
    let c = 0;
    let latest = null; // ISO string

    for (const h of history) {
      if (!h || typeof h !== "object") continue;
      const hk = String(h.vaccineKey || "").trim();
      const hd = String(h.dateISO || "").trim();
      if (!hk || !hd) continue;

      if (countKeys.has(hk)) {
        c += 1;
        if (latest === null || hd > latest) latest = hd;
      }
    }

    counts[vaccineKey] = c;
    lastDate[vaccineKey] = latest;
  }

  return { counts, lastDate };
}


/*******************************
 * STEP 4 — matchesClause(clause, p, doseIndex, vaccineKey)
 *
 * Goal:
 *  - Return true/false: does THIS clause match THIS patient?
 *  - Deterministic: always evaluate checks in the same order.
 *
 * Uses ONLY what you have:
 *  - p.ageYears / ageMonths / ageWeeks / birthYear
 *  - p.riskTagsSet / p.chronicConditionsSet
 *  - doseIndex.counts[vaccineKey] and doseIndex.lastDate[vaccineKey]
 *
 * Supported clause fields (from your ruleset):
 *  - minAgeYears, maxAgeYears
 *  - minAgeMonths, maxAgeMonths
 *  - minAgeWeeks, maxAgeWeeks
 *  - birthYearMin, birthYearMax
 *  - requireRiskTagsAny: string[]
 *  - forbidRiskTagsAny: string[]
 *  - requireChronicAny: string[]        (optional if you want)
 *  - forbidChronicAny: string[]         (optional if you want)
 *  - requireDosesLessThan: number
 *  - requireDosesAtLeast: number
 *  - minDaysSinceLastDose: number
 *
 *******************************/

// Re-use date helpers from Step 2:
/// parseISODateOnly, diffDaysUTC

function matchesClause(clause, p, doseIndex, vaccineKey) {
  if (!clause || typeof clause !== "object") return false;
  if (!p || typeof p !== "object") return false;
  if (!doseIndex || typeof doseIndex !== "object") return false;
  if (!vaccineKey) return false;

  const counts = doseIndex.counts || {};
  const lastDateMap = doseIndex.lastDate || {};

  const taken = Number.isFinite(counts[vaccineKey]) ? counts[vaccineKey] : 0;
  const lastDoseISO = typeof lastDateMap[vaccineKey] === "string" ? lastDateMap[vaccineKey] : null;

  // ---------- 1) AGE CHECKS ----------
  if (Number.isFinite(clause.minAgeYears) && p.ageYears < clause.minAgeYears) return false;
  if (Number.isFinite(clause.maxAgeYears) && p.ageYears >= clause.maxAgeYears) return false; // max is exclusive by default
  // If you want inclusive maxAgeYears, change to: p.ageYears > clause.maxAgeYears

  if (Number.isFinite(clause.minAgeMonths) && p.ageMonths < clause.minAgeMonths) return false;
  if (Number.isFinite(clause.maxAgeMonths) && p.ageMonths >= clause.maxAgeMonths) return false;

  if (Number.isFinite(clause.minAgeWeeks) && p.ageWeeks < clause.minAgeWeeks) return false;
  if (Number.isFinite(clause.maxAgeWeeks) && p.ageWeeks >= clause.maxAgeWeeks) return false;

  // ---------- 2) BIRTH YEAR CHECKS ----------
  if (Number.isFinite(clause.birthYearMin) && p.birthYear < clause.birthYearMin) return false;
  if (Number.isFinite(clause.birthYearMax) && p.birthYear > clause.birthYearMax) return false;

  // ---------- 3) REQUIRED RISK TAGS (ANY) ----------
  if (Array.isArray(clause.requireRiskTagsAny) && clause.requireRiskTagsAny.length > 0) {
    let ok = false;
    for (const tag of clause.requireRiskTagsAny) {
      if (p.riskTagsSet && p.riskTagsSet.has(tag)) {
        ok = true;
        break;
      }
    }
    if (!ok) return false;
  }

  // ---------- 4) FORBIDDEN RISK TAGS ----------
  if (Array.isArray(clause.forbidRiskTagsAny) && clause.forbidRiskTagsAny.length > 0) {
    for (const tag of clause.forbidRiskTagsAny) {
      if (p.riskTagsSet && p.riskTagsSet.has(tag)) return false;
    }
  }

  // ---------- 5) OPTIONAL CHRONIC CONDITION CHECKS ----------
  if (Array.isArray(clause.requireChronicAny) && clause.requireChronicAny.length > 0) {
    let ok = false;
    for (const cond of clause.requireChronicAny) {
      if (p.chronicConditionsSet && p.chronicConditionsSet.has(cond)) {
        ok = true;
        break;
      }
    }
    if (!ok) return false;
  }

  if (Array.isArray(clause.forbidChronicAny) && clause.forbidChronicAny.length > 0) {
    for (const cond of clause.forbidChronicAny) {
      if (p.chronicConditionsSet && p.chronicConditionsSet.has(cond)) return false;
    }
  }

  // ---------- 6) DOSE COUNT CHECKS ----------
  if (Number.isFinite(clause.requireDosesLessThan) && !(taken < clause.requireDosesLessThan)) return false;
  if (Number.isFinite(clause.requireDosesAtLeast) && !(taken >= clause.requireDosesAtLeast)) return false;

  // ---------- 7) MIN DAYS SINCE LAST DOSE ----------
  if (Number.isFinite(clause.minDaysSinceLastDose)) {
    // If clause requires time since last dose, we need a last dose date.
    if (!lastDoseISO) return false;

    const lastDoseDate = parseISODateOnly(lastDoseISO);
    const asOfDate = parseISODateOnly(p.asOfISO);
    if (!lastDoseDate || !asOfDate) return false;

    const daysSince = diffDaysUTC(lastDoseDate, asOfDate);
    if (daysSince < clause.minDaysSinceLastDose) return false;
  }

  return true;
}

/*******************************
 * STEP 5 — findMatchingClause(rule, p, doseIndex)
 *
 * Goal:
 *  - Given ONE vaccine rule, return the first clause that matches.
 *  - Clauses are already sorted by priority in preprocessRuleSet().
 *  - Deterministic: first match wins, then we STOP.
 *
 * Output:
 *  - returns the matching clause object, or null if none match
 *******************************/

function findMatchingClause(rule, p, doseIndex) {
  if (!rule || typeof rule !== "object") {
    throw new Error("findMatchingClause: rule must be an object");
  }
  const clauses = Array.isArray(rule.clauses) ? rule.clauses : [];
  if (clauses.length === 0) return null;

  const vaccineKey = rule.vaccineKey;
  for (const clause of clauses) {
    if (matchesClause(clause, p, doseIndex, vaccineKey)) {
      return clause; // FIRST match (highest priority) wins
    }
  }
  return null;
}

/*******************************
 * STEP 6 — resolveSeries(rule, clause)
 *
 * Goal:
 *  - Decide which series definition applies for THIS patient:
 *      seriesUsed = clause.seriesOverride ?? rule.series
 *  - Decide how many doses are required:
 *      requiredDoses = clause.requiredDosesOverride ?? seriesUsed.dosesRequiredDefault
 *
 * Output:
 *  {
 *    seriesUsed: object,
 *    requiredDoses: number
 *  }
 *
 * Notes:
 *  - If requiredDoses cannot be determined, we default to 1 (safe fallback).
 *******************************/

function resolveSeries(rule, clause) {
  if (!rule || typeof rule !== "object") {
    throw new Error("resolveSeries: rule must be an object");
  }
  if (!clause || typeof clause !== "object") {
    throw new Error("resolveSeries: clause must be an object");
  }

  const ruleSeries =
    rule.series && typeof rule.series === "object" && !Array.isArray(rule.series)
      ? rule.series
      : {};

  const clauseSeries =
    clause.seriesOverride && typeof clause.seriesOverride === "object" && !Array.isArray(clause.seriesOverride)
      ? clause.seriesOverride
      : null;

  const seriesUsed = clauseSeries ? { ...ruleSeries, ...clauseSeries } : { ...ruleSeries };

  // Determine required doses
  let requiredDoses = null;

  if (Number.isFinite(clause.requiredDosesOverride)) {
    requiredDoses = clause.requiredDosesOverride;
  } else if (Number.isFinite(seriesUsed.dosesRequiredDefault)) {
    requiredDoses = seriesUsed.dosesRequiredDefault;
  }

  if (!Number.isFinite(requiredDoses) || requiredDoses <= 0) {
    requiredDoses = 1; // fallback
  }

  return { seriesUsed, requiredDoses };
}

/*******************************
 * STEP 7 — computeNextDose(...)
 *
 * Goal:
 *  - After eligibility + series are known, compute:
 *      remainingDoses
 *      nextDoseNumber (if any)
 *      dueDateISO (YYYY-MM-DD) for the next dose/booster, or null if nothing due
 *      computationReason (string you can log/debug)
 *
 * Inputs:
 *  - rule: vaccine rule object (must contain vaccineKey)
 *  - clause: matched clause (only used for debug; can be null)
 *  - p: normalized profile from normalizeProfile()
 *  - doseIndex: output of buildDoseIndex()
 *  - seriesUsed: output series from resolveSeries()
 *  - requiredDoses: number from resolveSeries()
 *  - asOfISO: "YYYY-MM-DD"
 *******************************/

// ---- Date helpers (new for Step 7) ----

function addDaysUTC(dateUTC, days) {
  const d = new Date(dateUTC.getTime());
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

// Adds months but clamps day-of-month to last day in target month for stability
function addMonthsClampedUTC(dateUTC, monthsToAdd) {
  const y = dateUTC.getUTCFullYear();
  const m = dateUTC.getUTCMonth();
  const d = dateUTC.getUTCDate();

  const targetMonthIndex = m + monthsToAdd;
  const targetYear = y + Math.floor(targetMonthIndex / 12);
  const targetMonth = ((targetMonthIndex % 12) + 12) % 12; // safe mod

  // last day of target month: day 0 of next month
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  const clampedDay = Math.min(d, lastDay);

  return new Date(Date.UTC(targetYear, targetMonth, clampedDay));
}

// ---- Step 7 main ----

function computeNextDose(rule, clause, p, doseIndex, seriesUsed, requiredDoses, asOfISO) {
  if (!rule || typeof rule !== "object") throw new Error("computeNextDose: rule must be an object");
  const vaccineKey = rule.vaccineKey;
  if (!vaccineKey) throw new Error("computeNextDose: rule.vaccineKey missing");

  if (!p || typeof p !== "object") throw new Error("computeNextDose: p must be an object");
  if (!doseIndex || typeof doseIndex !== "object") throw new Error("computeNextDose: doseIndex must be an object");
  if (!seriesUsed || typeof seriesUsed !== "object") seriesUsed = {};
  if (!Number.isFinite(requiredDoses) || requiredDoses <= 0) requiredDoses = 1;

  const asOfDate = parseISODateOnly(asOfISO || p.asOfISO);
  if (!asOfDate) throw new Error("computeNextDose: asOfISO must be YYYY-MM-DD");

  const taken = Number.isFinite(doseIndex.counts?.[vaccineKey]) ? doseIndex.counts[vaccineKey] : 0;
  const lastDoseISO = typeof doseIndex.lastDate?.[vaccineKey] === "string" ? doseIndex.lastDate[vaccineKey] : null;

  // Optional lifetime cap (some rules include maxLifetimeDoses)
  if (Number.isFinite(seriesUsed.maxLifetimeDoses) && taken >= seriesUsed.maxLifetimeDoses) {
    return {
      remainingDoses: 0,
      nextDoseNumber: null,
      dueDateISO: null,
      computationReason: "Max lifetime doses reached"
    };
  }

  let remainingDoses = Math.max(0, requiredDoses - taken);

  // If still completing primary series
  if (remainingDoses > 0) {
    const nextDoseNumber = taken + 1;

    // A) Milestone-based (age-based due dates)
    const milestones = Array.isArray(seriesUsed.doseMilestones) ? seriesUsed.doseMilestones : null;
    if (milestones && milestones.length > 0) {
      const milestone = milestones.find(m => Number(m.doseNumber) === Number(nextDoseNumber));

      // If we have a milestone for this next dose, compute due date from DOB
      if (milestone) {
        const dob = parseISODateOnly(p.dateOfBirthISO);
        if (!dob) throw new Error("computeNextDose: p.dateOfBirthISO missing/invalid");

        let dueDate = null;
        if (Number.isFinite(milestone.earliestAgeMonths)) {
          dueDate = addMonthsClampedUTC(dob, milestone.earliestAgeMonths);
          return {
            remainingDoses,
            nextDoseNumber,
            dueDateISO: formatISODateOnly(dueDate),
            computationReason: `Dose milestone: DOB + ${milestone.earliestAgeMonths} months (dose ${nextDoseNumber})`
          };
        }
        if (Number.isFinite(milestone.earliestAgeWeeks)) {
          dueDate = addDaysUTC(dob, milestone.earliestAgeWeeks * 7);
          return {
            remainingDoses,
            nextDoseNumber,
            dueDateISO: formatISODateOnly(dueDate),
            computationReason: `Dose milestone: DOB + ${milestone.earliestAgeWeeks} weeks (dose ${nextDoseNumber})`
          };
        }

        // fallback if milestone exists but doesn't define earliest age
        return {
          remainingDoses,
          nextDoseNumber,
          dueDateISO: formatISODateOnly(asOfDate),
          computationReason: `Milestone found for dose ${nextDoseNumber}, but no earliestAge provided; defaulting dueDate to asOf`
        };
      }

      // If milestone list exists but we don't have a milestone for that dose number:
      // fall through to interval logic.
    }

    // B) Interval-based
    const minIntervalDays =
      Number.isFinite(seriesUsed.minIntervalDaysDefault) ? seriesUsed.minIntervalDaysDefault : null;

    if (minIntervalDays != null && taken > 0 && lastDoseISO) {
      const lastDoseDate = parseISODateOnly(lastDoseISO);
      if (!lastDoseDate) throw new Error("computeNextDose: lastDoseISO invalid");

      const dueDate = addDaysUTC(lastDoseDate, minIntervalDays);
      return {
        remainingDoses,
        nextDoseNumber,
        dueDateISO: formatISODateOnly(dueDate),
        computationReason: `Min interval: lastDose + ${minIntervalDays} days (dose ${nextDoseNumber})`
      };
    }

    // C) If no milestone and no interval (or no last dose), due now
    return {
      remainingDoses,
      nextDoseNumber,
      dueDateISO: formatISODateOnly(asOfDate),
      computationReason: `No milestone/interval available; defaulting dueDate to asOf (dose ${nextDoseNumber})`
    };
  }

  // Primary series complete: check booster / seasonal repeat
  if (Number.isFinite(seriesUsed.repeatEveryDays)) {
    const repeatEveryDays = seriesUsed.repeatEveryDays;

    // If never had it, due now (eligible now)
    if (!lastDoseISO) {
      return {
        remainingDoses: 0,
        nextDoseNumber: null,
        dueDateISO: formatISODateOnly(asOfDate),
        computationReason: `Repeat schedule: no prior dose; due now`
      };
    }

    const lastDoseDate = parseISODateOnly(lastDoseISO);
    if (!lastDoseDate) throw new Error("computeNextDose: lastDoseISO invalid");

    const boosterDue = addDaysUTC(lastDoseDate, repeatEveryDays);
    return {
      remainingDoses: 0,
      nextDoseNumber: null,
      dueDateISO: formatISODateOnly(boosterDue),
      computationReason: `Repeat schedule: lastDose + ${repeatEveryDays} days`
    };
  }

  // Series complete and no booster schedule
  return {
    remainingDoses: 0,
    nextDoseNumber: null,
    dueDateISO: null,
    computationReason: "Series complete; no booster rule"
  };
}

/*******************************
 * STEP 8 — determineStatus(isEligible, dueDateISO, asOfISO, dueSoonWindowDays)
 *
 * Goal:
 *  - Convert eligibility + dueDate into one of:
 *      "ELIGIBLE" | "DUE_SOON" | "OVERDUE" | "NOT_ELIGIBLE"
 *
 * Rules:
 *  - If isEligible === false  -> NOT_ELIGIBLE
 *  - If dueDateISO is null    -> ELIGIBLE (nothing due; series complete or no schedule)
 *  - Else compare dueDateISO to asOfISO:
 *      dueDate < asOf  -> OVERDUE
 *      0 <= daysUntil <= dueSoonWindowDays -> DUE_SOON
 *      daysUntil > dueSoonWindowDays -> ELIGIBLE
 *******************************/

function determineStatus(isEligible, dueDateISO, asOfISO, dueSoonWindowDays) {
  if (!isEligible) return "NOT_ELIGIBLE";

  // If there's no due date (e.g., complete series and no booster)
  if (dueDateISO == null) return "ELIGIBLE";

  const asOf = parseISODateOnly(asOfISO);
  const due = parseISODateOnly(dueDateISO);

  // If date parsing fails, treat as eligible but "unscheduled"
  if (!asOf || !due) return "ELIGIBLE";

  const daysUntil = diffDaysUTC(asOf, due); // due - asOf
  const window = Number.isFinite(dueSoonWindowDays) ? dueSoonWindowDays : 30;

  if (daysUntil < 0) return "OVERDUE";
  if (daysUntil <= window) return "DUE_SOON";
  return "ELIGIBLE";
}

/*******************************
 * STEP 9 — buildReasons(rule, clause, p, doseIndex, requiredDoses, nextInfo, status)
 *
 * Goal:
 *  - Return a simple reasons[] array that:
 *    1) Includes the clause reasons (policy/eligibility reasons)
 *    2) Adds computed reasons (dose progress + due date + why)
 *
 * Inputs:
 *  - rule: vaccine rule object
 *  - clause: matched clause OR null
 *  - p: normalized profile
 *  - doseIndex: output of buildDoseIndex()
 *  - requiredDoses: number from resolveSeries()
 *  - nextInfo: output of computeNextDose()
 *  - status: output of determineStatus()
 *
 * Output:
 *  - string[]
 *******************************/

function buildReasons(rule, clause, p, doseIndex, requiredDoses, nextInfo, status) {
  const reasons = [];

  const vaccineKey = rule?.vaccineKey ?? "UNKNOWN";
  const taken = Number.isFinite(doseIndex?.counts?.[vaccineKey]) ? doseIndex.counts[vaccineKey] : 0;

  // 1) Clause reasons (most important)
  if (clause && Array.isArray(clause.reasons) && clause.reasons.length > 0) {
    for (const r of clause.reasons) reasons.push(String(r));
  }

  // 2) Debug/trace: which clause matched
  if (clause?.clauseId) {
    reasons.push(`Matched eligibility rule: ${clause.clauseId}`);
  } else {
    reasons.push(`No eligibility rule matched for ${vaccineKey}`);
  }

  // 3) Dose progress
  if (Number.isFinite(requiredDoses) && requiredDoses > 0) {
    reasons.push(`Dose history: ${Math.min(taken, requiredDoses)}/${requiredDoses} documented dose(s).`);
  } else {
    reasons.push(`Dose history: ${taken} documented dose(s).`);
  }

  // 4) Due date + status context (if eligible)
  if (status !== "NOT_ELIGIBLE") {
    if (nextInfo?.dueDateISO) {
      reasons.push(`Next dose due date: ${nextInfo.dueDateISO}.`);
    } else {
      reasons.push(`No next dose due date (series complete or no booster rule).`);
    }

    if (nextInfo?.computationReason) {
      reasons.push(`Schedule logic: ${nextInfo.computationReason}`);
    }
  }

  // 5) Optional: a short status hint (good for UI)
  reasons.push(`Status: ${status}.`);

  return reasons;
}

/*******************************
 * STEP 10 — evaluateVaccine(rule, p, doseIndex, options)
 *
 * Goal:
 *  - Run ONE vaccine end-to-end:
 *      1) findMatchingClause
 *      2) if none -> NOT_ELIGIBLE output
 *      3) resolveSeries
 *      4) computeNextDose
 *      5) determineStatus
 *      6) buildReasons
 *
 * Output (universal):
 * {
 *   vaccineKey: string,
 *   status: "ELIGIBLE"|"DUE_SOON"|"OVERDUE"|"NOT_ELIGIBLE",
 *   dueDate: "YYYY-MM-DD" | null,
 *   nextDoseNumber: number | null,
 *   remainingDoses: number,
 *   matchedClauseId: string | null,
 *   reasons: string[]
 * }
 *******************************/

function evaluateVaccine(rule, p, doseIndex, options = {}) {
  if (!rule || typeof rule !== "object") throw new Error("evaluateVaccine: rule must be an object");
  if (!p || typeof p !== "object") throw new Error("evaluateVaccine: p must be an object");
  if (!doseIndex || typeof doseIndex !== "object") throw new Error("evaluateVaccine: doseIndex must be an object");

  const asOfISO = typeof options.asOfISO === "string" ? options.asOfISO : p.asOfISO;
  const dueSoonWindowDays = Number.isFinite(options.dueSoonWindowDays)
    ? options.dueSoonWindowDays
    : 30;

  const vaccineKey = rule.vaccineKey;
  const displayName = rule.displayName || vaccineKey;

  const takenDoses = Number.isFinite(doseIndex.counts?.[vaccineKey]) ? doseIndex.counts[vaccineKey] : 0;
  const lastDoseDate = typeof doseIndex.lastDate?.[vaccineKey] === "string" ? doseIndex.lastDate[vaccineKey] : null;

  // 1) Eligibility: pick best clause
  const clause = findMatchingClause(rule, p, doseIndex);

  // If no clause matched -> NOT_ELIGIBLE, but still return useful info for chatbot
  if (!clause) {
    const nextInfo = { remainingDoses: 0, nextDoseNumber: null, dueDateISO: null, computationReason: "Not eligible" };
    const status = "NOT_ELIGIBLE";
    const reasons = buildReasons(rule, null, p, doseIndex, 0, nextInfo, status);

    return {
      vaccineKey,
      displayName,
      status,
      dueDate: null,
      nextDoseNumber: null,
      remainingDoses: 0,

      takenDoses,
      requiredDoses: 0,
      lastDoseDate,

      matchedClauseId: null,
      computationReason: nextInfo.computationReason,
      reasons
    };
  }

  // 2) Series
  const { seriesUsed, requiredDoses } = resolveSeries(rule, clause);

  // 3) Schedule
  const nextInfo = computeNextDose(rule, clause, p, doseIndex, seriesUsed, requiredDoses, asOfISO);

  // 4) Status
  const status = determineStatus(true, nextInfo.dueDateISO, asOfISO, dueSoonWindowDays);

  // 5) Reasons
  const reasons = buildReasons(rule, clause, p, doseIndex, requiredDoses, nextInfo, status);

  return {
    vaccineKey,
    displayName,
    status,
    dueDate: nextInfo.dueDateISO ?? null,
    nextDoseNumber: nextInfo.nextDoseNumber ?? null,
    remainingDoses: nextInfo.remainingDoses ?? 0,

    takenDoses,
    requiredDoses,
    lastDoseDate,

    matchedClauseId: clause.clauseId ?? null,
    computationReason: nextInfo.computationReason ?? null,
    reasons
  };
}

/*******************************
 * STEP 11 — evaluateAllVaccines(profile, preprocessedRuleSet, options)
 *
 * Goal:
 *  - Full engine entry point for ONE patient profile.
 *  - Runs:
 *      preprocessRuleSet()  <-- already done once at startup (you pass `pre`)
 *      normalizeProfile()
 *      buildDoseIndex()
 *      evaluateVaccine() for every vaccine in pre.vaccineRules
 *  - Returns a list of vaccine results.
 *
 * Options:
 *  - asOfISO: "YYYY-MM-DD"
 *  - dueSoonWindowDays: number
 *  - sortResults: boolean (default true)
 *
 * Sorting (optional but nice):
 *  - OVERDUE first, then DUE_SOON, then ELIGIBLE, then NOT_ELIGIBLE
 *  - Within same status: earliest dueDate first (nulls last)
 *******************************/

function evaluateAllVaccines(profile, pre, options = {}) {
  if (!pre || typeof pre !== "object" || !Array.isArray(pre.vaccineRules)) {
    throw new Error("evaluateAllVaccines: pre must be a preprocessed ruleset (run preprocessRuleSet first)");
  }

  const asOfISO = typeof options.asOfISO === "string" ? options.asOfISO : "2026-02-20";
  const dueSoonWindowDays =
    Number.isFinite(options.dueSoonWindowDays) ? options.dueSoonWindowDays :
    (Number.isFinite(pre.dueSoonWindowDays) ? pre.dueSoonWindowDays : 30);

  const sortResults = options.sortResults !== false;

  // 1) Normalize patient
  const p = normalizeProfile(profile, asOfISO);

  // 2) Dose index
  const doseIndex = buildDoseIndex(p, pre);

  // 3) Evaluate each vaccine
  const results = [];
  for (const rule of pre.vaccineRules) {
    results.push(
      evaluateVaccine(rule, p, doseIndex, {
        asOfISO,
        dueSoonWindowDays
      })
    );
  }

  if (!sortResults) return results;

  // 4) Sort results
  const rank = { OVERDUE: 0, DUE_SOON: 1, ELIGIBLE: 2, NOT_ELIGIBLE: 3 };

  results.sort((a, b) => {
    const ra = rank[a.status] ?? 99;
    const rb = rank[b.status] ?? 99;
    if (ra !== rb) return ra - rb;

    // If same status, sort by dueDate (earlier first), null last
    const da = a.dueDate;
    const db = b.dueDate;
    if (da == null && db == null) return a.vaccineKey.localeCompare(b.vaccineKey);
    if (da == null) return 1;
    if (db == null) return -1;
    if (da !== db) return da < db ? -1 : 1;

    return a.vaccineKey.localeCompare(b.vaccineKey);
  });

  return results;
}

export {preprocessRuleSet, evaluateAllVaccines};
