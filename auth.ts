import type { NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import { guardarTokensGoogle } from "@/lib/google-calendar";

export const authOptions: NextAuthOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.AUTH_GOOGLE_ID ?? "",
      clientSecret: process.env.AUTH_GOOGLE_SECRET ?? "",
      authorization: {
        params: {
          scope:
            "openid email profile https://www.googleapis.com/auth/calendar.events",
          access_type: "offline",
          prompt: "consent"
        }
      }
    })
  ],
  callbacks: {
    async jwt({ token, account }) {
      const userId = token.sub ?? account?.providerAccountId;
      if (account?.provider === "google" && userId && account.access_token) {
        try {
          await guardarTokensGoogle(userId, {
            accessToken: account.access_token,
            refreshToken: account.refresh_token,
            expiresAt: new Date((account.expires_at ?? 0) * 1000 || Date.now() + 3600_000)
          });
        } catch (error) {
          console.error("No se pudieron guardar los tokens de Google Calendar:", error);
        }
      }

      return token;
    },
    session({ session, token }) {
      if (session.user && token.sub) {
        session.user.id = token.sub;
      }

      return session;
    }
  },
  secret: process.env.AUTH_SECRET
};
