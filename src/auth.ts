import { compare } from "bcryptjs";
import NextAuth, { CredentialsSignin } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { z } from "zod";

import { clearAccountFailures, isLoginThrottled, loginKeys, pruneLoginAttempts, recordLoginFailure } from "@/server/auth/login-throttle";
import { db } from "@/server/db";

class LoginRateLimited extends CredentialsSignin {
  code = "rate_limited";
}

const credentialsSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email().max(254)),
  password: z.string().min(1).max(200),
});

export const { auth, handlers, signIn, signOut } = NextAuth({
  pages: { signIn: "/login" },
  session: { strategy: "jwt" },
  providers: [
    Credentials({
      credentials: {
        email: { label: "อีเมล", type: "email" },
        password: { label: "รหัสผ่าน", type: "password" },
      },
      async authorize(credentials, request) {
        const parsed = credentialsSchema.safeParse(credentials);
        if (!parsed.success) return null;

        const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
        const keys = loginKeys(parsed.data.email, ip);
        if (await isLoginThrottled(keys)) throw new LoginRateLimited();

        const user = await db.user.findUnique({
          where: { email: parsed.data.email },
          select: { id: true, name: true, email: true, passwordHash: true, isActive: true },
        });
        // Invited accounts have no password until the invitation is accepted.
        const validPassword = !!user?.isActive && !!user.passwordHash && await compare(parsed.data.password, user.passwordHash);
        if (!user || !validPassword) {
          await recordLoginFailure(keys);
          if (Math.random() < 0.05) await pruneLoginAttempts();
          return null;
        }

        await clearAccountFailures(keys);
        return { id: user.id, name: user.name, email: user.email };
      },
    }),
  ],
  callbacks: {
    session({ session, token }) {
      if (token.sub && session.user) session.user.id = token.sub;
      return session;
    },
  },
});
