// functions/src/index.ts
import * as admin from "firebase-admin";

admin.initializeApp();

export { disburseLoan, recordRepayment } from "./loans";
