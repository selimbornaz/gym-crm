import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Prisma doit rester côté serveur (pas de bundling du moteur natif).
  serverExternalPackages: ["@prisma/client"],
};

export default nextConfig;
