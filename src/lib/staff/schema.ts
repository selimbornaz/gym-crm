import { z } from "zod";

/** Règles communes au formulaire (site et application) et au pont /api/chatbot/remote. */
export const staffPassword = z
  .string()
  .min(8, "8 caractères minimum")
  .max(72, "72 caractères maximum")
  .refine((v) => /[A-Za-z]/.test(v) && /\d/.test(v), "Au moins une lettre et un chiffre");

export const staffRole = z.enum(["owner", "receptionist", "coach"], { errorMap: () => ({ message: "Rôle requis" }) });

export const staffEmail = z.string().trim().email("Email invalide").transform((v) => v.toLowerCase());
