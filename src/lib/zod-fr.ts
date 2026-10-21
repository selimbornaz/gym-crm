import { z, ZodIssueCode, type ZodErrorMap } from "zod";

/**
 * Messages Zod par défaut en français. Les schémas peuvent toujours fournir un
 * message spécifique ; celui-ci ne sert que de repli (ex. champ vide => "Required").
 */
const frErrorMap: ZodErrorMap = (issue, ctx) => {
  switch (issue.code) {
    case ZodIssueCode.invalid_type:
      if (issue.received === "undefined" || issue.received === "null") return { message: "Champ requis" };
      return { message: "Valeur invalide" };
    case ZodIssueCode.invalid_string:
      if (issue.validation === "email") return { message: "Adresse email invalide" };
      if (issue.validation === "uuid") return { message: "Identifiant invalide" };
      return { message: "Format invalide" };
    case ZodIssueCode.too_small:
      return { message: issue.type === "string" ? `${issue.minimum} caractère(s) minimum` : `Valeur minimale : ${issue.minimum}` };
    case ZodIssueCode.too_big:
      return { message: issue.type === "string" ? `${issue.maximum} caractères maximum` : `Valeur maximale : ${issue.maximum}` };
    case ZodIssueCode.invalid_enum_value:
    case ZodIssueCode.invalid_literal:
      return { message: "Valeur non autorisée" };
    case ZodIssueCode.invalid_date:
      return { message: "Date invalide" };
    default:
      return { message: ctx.defaultError };
  }
};

z.setErrorMap(frErrorMap);
