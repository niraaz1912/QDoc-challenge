
import { doc, setDoc, serverTimestamp } from "firebase/firestore";

import { RULE_SET } from "./ruleSet.js";
import { preprocessRuleSet, evaluateAllVaccines } from "./ruleEngine.js";

export async function computeAndStoreRuleEngineResult({ db, uid, payloadToSave }) {

  const preRule = preprocessRuleSet(RULE_SET);

  // compute
  const ruleEngineResult = evaluateAllVaccines(payloadToSave, preRule);

  console.log("Writing to:", `ruleEngineResult/${uid}`);

  // store in separate collection with SAME uid as doc id
  await setDoc(
    doc(db, "ruleEngineResult", uid),
    {
      uid,
      result: ruleEngineResult,
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );

  return ruleEngineResult; // ✅ return it
}







// Print only useful fields (and reasons for the chatbot)
// console.log(
//   results.map(r => ({
//     vaccineKey: r.vaccineKey,
//     status: r.status,
//     dueDate: r.dueDate,
//     remainingDoses: r.remainingDoses,
//     nextDoseNumber: r.nextDoseNumber,
//     matchedClauseId: r.matchedClauseId,
//     reasons: r.reasons
//   }))
// );
