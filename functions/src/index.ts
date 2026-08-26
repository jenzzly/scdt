// functions/src/index.ts
import * as admin from "firebase-admin";
import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { defineSecret } from "firebase-functions/params";
import { Resend } from "resend";

admin.initializeApp();

export { disburseLoan, recordRepayment } from "./loans";

const resendApiKey = defineSecret("RESEND_API_KEY");

function escapeHtml(value: unknown): string {
	return String(value ?? "")
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/\"/g, "&quot;")
		.replace(/'/g, "&#039;");
}

export const sendNotificationEmail = onDocumentCreated(
	{ document: "users/{userId}/notifications/{notificationId}", secrets: [resendApiKey] },
	async (event) => {
		const notification = event.data?.data();
		if (!notification || notification.read !== false) return;

		const user = await admin.auth().getUser(event.params.userId);
		if (!user.email) return;

		const title = escapeHtml(notification.title || "New notification");
		const message = escapeHtml(notification.message || "You have a new notification.");
		const resend = new Resend(resendApiKey.value());
		const { error } = await resend.emails.send({
			from: process.env.RESEND_FROM_EMAIL || "onboarding@resend.dev",
			to: user.email,
			subject: notification.title || "New notification",
			html: `<h2>${title}</h2><p>${message}</p>`,
		});
		if (error) throw new Error(`Resend email failed: ${error.message}`);
	},
);
