// lib/firestore/index.ts
//
// Barrel file. This file is the only reason `import * as FS from
// "../lib/firestore"` still works exactly as before the split — every
// function that used to live in one 2,000-line lib/firestore.ts is now
// in its own domain module below, and re-exported here unchanged.
//
// Module map:
//   core.ts          shared helpers, collection refs, types (not usually
//                     imported directly by screens — domain modules use it)
//   audit.ts          audit log read/write
//   groups.ts          group CRUD
//   members.ts          member CRUD + email-based merge/link logic
//   contributions.ts     contribution CRUD + approve/reject
//   loans.ts             loan CRUD + approve/reject (disbursement/repayment
//                         math now delegated to Cloud Functions — see
//                         functions/src/loans.ts and the callable wrappers
//                         at the bottom of this file)
//   investments.ts       investment CRUD + approve/reject
//   wallet.ts             wallet transaction CRUD
//   expenses.ts            expense CRUD + approve/reject
//   meetings.ts             meeting CRUD + attendance
//   notifications.ts        per-user notifications
//   groupInit.ts             new-group bootstrap + bulk restore
//   deletions.ts              deletion history + cascade deletes

export * from "./audit";
export * from "./groups";
export * from "./members";
export * from "./contributions";
export * from "./loans";
export * from "./investments";
export * from "./wallet";
export * from "./expenses";
export * from "./meetings";
export * from "./notifications";
export * from "./groupInit";
export * from "./deletions";

// getMembershipId is defined in core.ts (used internally by several domain
// modules) but screens also import it directly off the FS namespace.
export { getMembershipId } from "./core";
