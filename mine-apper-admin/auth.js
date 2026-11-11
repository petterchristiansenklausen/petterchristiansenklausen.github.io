import NextAuth from "next-auth";
import GitHub from "next-auth/providers/github";

// The existing Vercel Deployment Protection gate is only the outer layer.
// This application also requires its own validated OAuth session and an exact numeric GitHub ID allowlist.
export function authConfigured() {
  return Boolean(
    process.env.AUTH_SECRET &&
    process.env.AUTH_GITHUB_ID &&
    process.env.AUTH_GITHUB_SECRET &&
    /^\d+$/.test(process.env.ADMIN_GITHUB_USER_ID || "")
  );
}
export function isAdminSession(session) {
  return authConfigured() &&
    Boolean(session?.adminGithubId) &&
    String(session.adminGithubId) === String(process.env.ADMIN_GITHUB_USER_ID);
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [GitHub],
  session: { strategy: "jwt", maxAge: 60 * 60 },
  trustHost: true,
  pages: { signIn: "/sign-in", error: "/sign-in" },
  callbacks: {
    async signIn({ account, profile }) {
      return authConfigured() &&
        account?.provider === "github" &&
        Boolean(profile?.id) &&
        String(profile.id) === String(process.env.ADMIN_GITHUB_USER_ID);
    },
    async jwt({ token, account, profile }) {
      if (account?.provider === "github" && profile?.id) {
        token.adminGithubId = String(profile.id);
      }
      return token;
    },
    async session({ session, token }) {
      session.adminGithubId = token.adminGithubId ?? null;
      return session;
    }
  }
});
