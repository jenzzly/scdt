// lib/auth/adminUsers.ts
//
// Admin user creation functionality
// Allows admins to create new Firebase Auth accounts without signing out
import { createUserWithSecondaryAuth, sendPasswordResetWithSecondaryAuth } from "./secondaryAuth";
import { addMember } from "../firestore/members";
import { writeAuditLog } from "../firestore/audit";
import { isValidRole, type UserRole } from "../../types/roles";

export interface CreateUserData {
  fullName: string;
  email: string;
  phone?: string;
  role: UserRole;
  groupId: string;
}

export async function createUserAsAdmin(
  data: CreateUserData,
  adminUserId: string,
  adminUserName: string
): Promise<{ success: boolean; userId?: string; error?: string }> {
  try {
    // Validate role
    if (!isValidRole(data.role)) {
      return { success: false, error: "Invalid role specified" };
    }

    // Generate a temporary password (user will reset via email)
    const tempPassword = generateTempPassword();

    // Create Firebase Auth account using secondary auth
    const { uid, email } = await createUserWithSecondaryAuth(data.email, tempPassword);

    // Create member document
    const memberId = await addMember(data.groupId, {
      userId: uid,
      fullName: data.fullName,
      email: data.email,
      phone: data.phone || "",
      role: data.role,
      status: "active",
      groupId: data.groupId,
      dateJoined: new Date().toISOString(),
      totalContributions: 0,
      totalSavings: 0,
      loanEarnings: 0,
    });

    // Send password reset email
    await sendPasswordResetWithSecondaryAuth(data.email);

    // Log the action
    await writeAuditLog(data.groupId, {
      userId: adminUserId,
      userName: adminUserName,
      groupId: data.groupId,
      action: "CREATE_USER",
      entityType: "member",
      entityId: memberId,
      after: {
        fullName: data.fullName,
        email: data.email,
        role: data.role,
        status: "active",
      },
      reason: "Admin created new user account",
    });

    return { success: true, userId: uid };
  } catch (error: any) {
    console.error("[createUserAsAdmin] Error:", error);
    
    // Handle specific Firebase Auth errors
    if (error.code === "auth/email-already-in-use") {
      return { 
        success: false, 
        error: "This email already has a Firebase account. Ask the user to sign in or use the invitation/linking process." 
      };
    }
    
    if (error.code === "auth/invalid-email") {
      return { success: false, error: "Invalid email address" };
    }
    
    if (error.code === "auth/weak-password") {
      return { success: false, error: "Password is too weak" };
    }
    
    return { success: false, error: error.message || "Failed to create user" };
  }
}

export async function resetUserPasswordAsAdmin(
  email: string,
  adminUserId: string,
  adminUserName: string,
  groupId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    // Send password reset email using secondary auth
    await sendPasswordResetWithSecondaryAuth(email);

    // Log the action
    await writeAuditLog(groupId, {
      userId: adminUserId,
      userName: adminUserName,
      groupId,
      action: "PASSWORD_RESET_REQUEST",
      entityType: "member",
      entityId: email, // Using email as identifier since we may not have memberId
      after: { email },
      reason: "Admin initiated password reset for user",
    });

    return { success: true };
  } catch (error: any) {
    console.error("[resetUserPasswordAsAdmin] Error:", error);
    
    if (error.code === "auth/invalid-email") {
      return { success: false, error: "Invalid email address" };
    }
    
    if (error.code === "auth/user-not-found") {
      // Don't reveal whether user exists for security
      return { success: true }; 
    }
    
    return { success: false, error: error.message || "Failed to send password reset" };
  }
}

function generateTempPassword(): string {
  // Generate a secure temporary password
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*";
  let password = "";
  for (let i = 0; i < 16; i++) {
    password += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return password;
}