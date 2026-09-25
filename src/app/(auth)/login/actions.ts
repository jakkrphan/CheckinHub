"use server";

import { AuthError, CredentialsSignin } from "next-auth";

import { signIn } from "@/auth";
import { safeReturnTo } from "@/server/auth/return-to";

export type LoginState = { error?: "invalid" | "rate-limited"; email?: string };

export async function login(_previous: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get("email") ?? "").slice(0, 254);
  try {
    await signIn("credentials", {
      email,
      password: formData.get("password"),
      // Staff without organizer access are forwarded to check-in by the organizer page itself.
      redirectTo: safeReturnTo(formData.get("next")) ?? "/organizer",
    });
    return {};
  } catch (cause) {
    if (cause instanceof CredentialsSignin && cause.code === "rate_limited") return { error: "rate-limited", email };
    if (cause instanceof AuthError) return { error: "invalid", email };
    throw cause;
  }
}
