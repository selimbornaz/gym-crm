/** État renvoyé par les Server Actions aux formulaires (partagé client/serveur). */
export interface ActionState {
  ok?: boolean;
  message?: string;
  error?: string;
  fieldErrors?: Record<string, string>;
  /** Données facultatives (ex. id créé, résultat de check-in). */
  data?: unknown;
}

export const initialState: ActionState = {};
