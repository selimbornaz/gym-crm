import type { NextConfig } from "next";

const desktop = process.env.NEXT_PUBLIC_CASTLE_DESKTOP === "1";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Prisma doit rester côté serveur (pas de bundling du moteur natif).
  serverExternalPackages: ["@prisma/client"],
  // Application de bureau : serveur autonome, construit à part du site web.
  ...(desktop ? { output: "standalone" as const, distDir: ".next-desktop" } : {}),
};

export default nextConfig;
