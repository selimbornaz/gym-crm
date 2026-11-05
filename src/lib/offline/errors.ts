/** Erreurs de la couche locale, au format des erreurs PostgREST lues par dbErrorMessage. */
export interface LocalError {
  code: string;
  message: string;
}

export interface LocalResult {
  data: unknown;
  error: LocalError | null;
  count: number | null;
  status: number;
  statusText: string;
}

export const ok = (data: unknown, count: number | null = null): LocalResult => ({ data, error: null, count, status: 200, statusText: "OK" });

export const failure = (code: string, message: string): LocalResult => ({
  data: null, error: { code, message }, count: null, status: 400, statusText: "",
});

/** Action réellement impossible sans Internet (clé d'administration, envoi de fichier...). */
export const NEEDS_INTERNET = failure("22023", "Cette action nécessite Internet : réessayez une fois reconnecté.");

export const NOT_ALLOWED = failure("42501", "Action non autorisée");
