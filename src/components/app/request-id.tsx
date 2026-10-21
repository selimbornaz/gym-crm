"use client";

import { useState } from "react";

/**
 * Clé d'idempotence générée UNE fois par ouverture de formulaire. Renvoyée
 * telle quelle en cas de double clic ou de retry : le serveur reconnaît la
 * demande et ne crée pas de doublon (abonnement, paiement, remboursement).
 */
export function RequestId({ name = "request_id" }: { name?: string }) {
  const [id] = useState(() => crypto.randomUUID());
  return <input type="hidden" name={name} value={id} />;
}
