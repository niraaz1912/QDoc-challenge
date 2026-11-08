// src/context/AuthContext.jsx
import React, { useEffect, useMemo, useState } from "react";
import { AuthContext } from "./AuthStore";
import { auth, db } from "../firebase";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  updateProfile,
  setPersistence,
  browserLocalPersistence,   // ✅ add
} from "firebase/auth";
import { doc, setDoc, serverTimestamp, getDoc } from "firebase/firestore";

export function AuthProvider({ children }) {
  const [userDoc, setUserDoc] = useState(null);
  const [userDocLoading, setUserDocLoading] = useState(false);

  // ✅ NEW: rule engine result state
  const [userRuleEngineResult, setUserRuleEngineResult] = useState(null);
  const [userRuleEngineResultLoading, setUserRuleEngineResultLoading] = useState(false);

  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);

  useEffect(() => {
  setPersistence(auth, browserLocalPersistence).catch((err) => {
    console.error("Failed to set auth persistence:", err);
  });
}, []);

  // ✅ Helper to refresh both docs on demand
  async function refreshComputed(uid) {
    if (!uid) return;

    setUserDocLoading(true);
    setUserRuleEngineResultLoading(true);

    try {
      const [userSnap, ruleSnap] = await Promise.all([
        getDoc(doc(db, "users", uid)),
        getDoc(doc(db, "ruleEngineResult", uid)),
      ]);

      setUserDoc(userSnap.exists() ? { id: userSnap.id, ...userSnap.data() } : null);
      setUserRuleEngineResult(ruleSnap.exists() ? ruleSnap.data() : null);
    } catch (err) {
      console.error("Failed to refresh user/rule docs:", err);
      setUserDoc(null);
      setUserRuleEngineResult(null);
    } finally {
      setUserDocLoading(false);
      setUserRuleEngineResultLoading(false);
    }
  }

  // ✅ Keep React state in sync with Firebase Auth state (covers login + signup)
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      setUser(u || null);
      setAuthLoading(false);

      if (!u) {
        setUserDoc(null);
        setUserRuleEngineResult(null);
        setUserDocLoading(false);
        setUserRuleEngineResultLoading(false);
        return;
      }

      await refreshComputed(u.uid);
    });

    return () => unsub();
  }, []);

  async function signup({ email, password, displayName }) {
    const cred = await createUserWithEmailAndPassword(auth, email, password);

    if (displayName) {
      await updateProfile(cred.user, { displayName });
    }

    setDoc(
      doc(db, "users", cred.user.uid),
      {
        displayName: displayName || "",
        email,
        createdAt: serverTimestamp(),
        reminderPrefs: { channel: "inApp", daysBeforeDue: 7 },
        role: "patient",
      },
      { merge: true }
    ).catch((err) => {
      console.error("Firestore user doc write failed:", err);
    });

    // optional: refresh after signup doc write (nice-to-have)
    // await refreshComputed(cred.user.uid);

    return cred.user;
  }

  async function login({ email, password }) {
    try {
      const cred = await signInWithEmailAndPassword(auth, email.trim(), password);
      return cred.user;
    } catch (err) {
      console.error("Login failed:", err.code, err.message);
      throw err;
    }
  }

  async function logout() {
    await signOut(auth);
  }

  const value = useMemo(
    () => ({
      user,
      userDoc,
      userRuleEngineResult,
      authLoading,
      userDocLoading,
      userRuleEngineResultLoading,
      isAuthed: !!user,
      signup,
      login,
      logout,

      // ✅ expose setters + refresh so Profile.jsx can set immediately after compute
      setUserDoc,
      setUserRuleEngineResult,
      refreshComputed,
    }),
    [
      user,
      userDoc,
      userRuleEngineResult,
      authLoading,
      userDocLoading,
      userRuleEngineResultLoading,
    ]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
