/**
 * Dictionnaire français (langue par défaut).
 * Pour ajouter l'arabe : créer `ar.ts` avec la même forme (type `Dictionary`)
 * et l'enregistrer dans `src/i18n/index.ts` ; le layout gère déjà `dir="rtl"`.
 */
export const fr = {
  app: { name: "Gym CRM", tagline: "Gestion de salle de sport" },

  nav: {
    dashboard: "Tableau de bord",
    members: "Membres",
    leads: "Prospects",
    subscriptions: "Abonnements",
    payments: "Paiements",
    attendance: "Présences",
    schedule: "Planning",
    coaches: "Coachs",
    workouts: "Programmes",
    reports: "Rapports",
    expenses: "Dépenses",
    equipment: "Équipements",
    notifications: "Notifications",
    staff: "Employés",
    audit: "Journal d'audit",
    settings: "Paramètres",
  },

  roles: { owner: "Propriétaire", receptionist: "Accueil", coach: "Coach" },

  membershipStatus: {
    active: "Actif",
    expiring: "Expire bientôt",
    expired: "Expiré",
    suspended: "Suspendu",
    none: "Sans abonnement",
    archived: "Archivé",
  },

  subscriptionStatus: {
    active: "En cours",
    scheduled: "À venir",
    expired: "Expiré",
    suspended: "Suspendu",
    cancelled: "Annulé",
  },

  paymentStatus: { paid: "Payé", partial: "Partiel", unpaid: "Impayé" },

  planKind: { membership: "Abonnement", pass: "Pass", pt_package: "Pack coaching" },
  durationUnit: { day: "jour(s)", week: "semaine(s)", month: "mois", year: "an(s)" },

  gender: { female: "Femme", male: "Homme", unspecified: "Non précisé" },

  subscriptionEvent: {
    created: "Création", renewed: "Renouvellement", extended: "Prolongation",
    suspended: "Suspension", resumed: "Reprise", cancelled: "Annulation",
  },

  adjustmentType: { refund: "Remboursement", reversal: "Annulation" },

  expenseCategory: {
    rent: "Loyer", electricity: "Électricité", water: "Eau", equipment: "Équipement", salaries: "Salaires",
    maintenance: "Maintenance", marketing: "Marketing", supplies: "Fournitures", taxes: "Impôts & taxes", other: "Autre",
  },

  leadStatus: {
    to_contact: "À contacter", trial_scheduled: "Essai planifié", trial_done: "Essai effectué", won: "Gagné", lost: "Perdu",
  },
  fitnessGoal: {
    weight_loss: "Perte de poids", muscle_gain: "Prise de muscle", endurance: "Endurance", wellness: "Bien-être", other: "Autre",
  },
  leadSource: {
    walk_in: "Passage à l'accueil", website: "Site web", social_media: "Réseaux sociaux", referral: "Parrainage", other: "Autre",
  },

  checkinMethod: { search: "Recherche", member_code: "N° membre", qr: "QR code", manual: "Manuel" },

  sessionKind: { group_class: "Cours collectif", personal_training: "Coaching individuel" },
  sessionStatus: { scheduled: "Programmée", cancelled: "Annulée", completed: "Terminée" },
  bookingStatus: { booked: "Inscrit", cancelled: "Annulé", attended: "Présent", no_show: "Absent" },

  programStatus: { draft: "Brouillon", active: "Actif", completed: "Terminé", archived: "Archivé" },

  equipmentCondition: { new: "Neuf", good: "Bon", fair: "Moyen", poor: "Mauvais", out_of_service: "Hors service" },

  notificationType: {
    membership_expiring: "Expiration proche",
    membership_expired: "Abonnement expiré",
    unpaid_balance: "Solde impayé",
    upcoming_session: "Séance à venir",
    new_member: "Nouveau membre",
    announcement: "Annonce",
    equipment_maintenance: "Maintenance",
  },

  weekdays: ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"],

  common: {
    save: "Enregistrer",
    cancel: "Annuler",
    confirm: "Confirmer",
    edit: "Modifier",
    delete: "Supprimer",
    archive: "Archiver",
    search: "Rechercher",
    filter: "Filtrer",
    reset: "Réinitialiser",
    add: "Ajouter",
    close: "Fermer",
    back: "Retour",
    loading: "Chargement…",
    saving: "Enregistrement…",
    none: "Aucun",
    all: "Tous",
    yes: "Oui",
    no: "Non",
    previous: "Précédent",
    next: "Suivant",
    print: "Imprimer",
    export: "Exporter",
    reason: "Motif",
    notes: "Notes",
    actions: "Actions",
  },
} as const;

type Widen<T> = T extends string ? string : T extends readonly (infer U)[] ? readonly Widen<U>[] : { [K in keyof T]: Widen<T[K]> };
export type Dictionary = Widen<typeof fr>;
