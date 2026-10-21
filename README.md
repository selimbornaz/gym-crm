# Gym CRM — gestion de salle de sport

Application web de gestion pour salles de sport : membres, abonnements, encaissements, présences, coachs, programmes, planning, rapports financiers, équipements, personnel et journal d'audit.
Interface en français, montants en **dinars tunisiens (TND, 3 décimales)**, heures affichées en **Africa/Tunis**.
Architecture **multi-salles (SaaS)** dès la première version : chaque salle est un tenant isolé par la base de données.

> La version précédente (Prisma + Kanban) est archivée dans `backup-v1-prisma.tar.gz`.

## Sommaire
1. [Stack](#stack)
2. [Démarrage rapide](#démarrage-rapide)
3. [Configuration Supabase](#configuration-supabase)
4. [Création du premier propriétaire](#création-du-premier-propriétaire)
5. [Déploiement Vercel](#déploiement-vercel)
6. [Rôles et permissions](#rôles-et-permissions)
7. [Modèle de sécurité](#modèle-de-sécurité)
8. [Règles financières](#règles-financières)
9. [Tests](#tests)
10. [Fonctionnalités](#fonctionnalités)
11. [Intégrations restant à brancher](#intégrations-restant-à-brancher)

## Stack

| Couche | Choix |
|---|---|
| Frontend | Next.js 15 (App Router), React 19, TypeScript strict |
| UI | Tailwind CSS v4, composants shadcn/ui (Radix), thème clair/sombre, lucide-react, Recharts |
| Backend | Server Components + Server Actions (validation Zod côté serveur) |
| Base de données | Supabase PostgreSQL, RLS sur toutes les tables, fonctions SQL transactionnelles |
| Authentification | Supabase Auth (email + mot de passe, invitations, réinitialisation) |
| Fichiers | Supabase Storage (buckets privés, URL signées) |
| Hébergement | Vercel (+ Vercel Cron pour les alertes quotidiennes) |

```
supabase/
  migrations/          SQL : tables, contraintes, fonctions métier, RLS, stockage
  tests/run-local.ts   48 tests de sécurité et de règles métier (PostgreSQL local)
scripts/bootstrap-owner.ts   création sécurisée de la 1re salle + propriétaire
src/
  app/(auth)/          connexion, mot de passe oublié, définition du mot de passe
  app/(app)/           modules (tableau de bord, membres, abonnements, paiements…)
  app/api/cron/        tâche planifiée des notifications
  lib/                 clients Supabase, contexte d'autorisation, formatage TND/Tunis
  i18n/fr.ts           dictionnaire français (structure prête pour l'arabe)
```

## Démarrage rapide

```bash
npm install
cp .env.example .env.local      # puis renseigner les clés Supabase
npm run dev                     # http://localhost:3000
```

Scripts utiles : `npm run build`, `npm run typecheck`, `npm run db:test`, `npm run bootstrap:owner`.

## Configuration Supabase

1. **Créer un projet** sur [supabase.com](https://supabase.com) (région la plus proche, ex. Europe).
2. **Clés** : *Project Settings → API* → copier l'URL, la clé `anon` et la clé `service_role` dans `.env.local`.
   La clé `service_role` ne doit **jamais** être exposée au navigateur (elle n'est lue que dans des modules `server-only`).
3. **Migrations** : appliquer les fichiers de `supabase/migrations/` **dans l'ordre**, au choix :
   - avec la CLI : `npx supabase link --project-ref <ref>` puis `npx supabase db push` ;
   - ou en copiant chaque fichier dans *SQL Editor* et en l'exécutant.
4. **Authentification** (*Authentication → URL Configuration*) :
   - *Site URL* : l'URL de production (ex. `https://crm.masalle.tn`) ;
   - *Redirect URLs* : ajouter `http://localhost:3000/**` et `https://<votre-domaine>/**`.
5. **Modèles d'email** (*Authentication → Email Templates*), remplacer le lien par :
   - *Invite user* : `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=invite&next=/update-password`
   - *Reset password* : `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery&next=/update-password`
6. **Désactiver l'inscription publique** (*Authentication → Providers → Email* : décocher « Allow new users to sign up »). Les comptes sont créés uniquement par invitation du propriétaire.
7. **Emails en production** : le service d'email intégré de Supabase est limité ; configurer un SMTP (*Project Settings → Auth → SMTP*).
8. **Types TypeScript (recommandé)** : `npx supabase gen types typescript --project-id <ref> > src/lib/database.types.ts` pour remplacer les types écrits à la main de `src/lib/types.ts`.

## Création du premier propriétaire

Processus sécurisé, exécuté **une seule fois en local** par la personne qui installe l'application :

```bash
npm run bootstrap:owner -- --email proprio@masalle.tn --name "Prénom Nom" --org "Ma Salle" --slug ma-salle --default-plans
```

- Sans `OWNER_PASSWORD`, une **invitation** est envoyée : le propriétaire choisit son mot de passe via le lien.
- Avec `OWNER_PASSWORD` défini dans l'environnement (jamais en argument de ligne de commande), le compte est créé directement.
- `--default-plans` ajoute des formules d'exemple (mensuel, trimestriel, semestriel, annuel, pass jour/semaine, pack coaching), modifiables ensuite.
- Le script est **idempotent** : le relancer ne crée pas de doublon.

Le propriétaire invite ensuite son équipe depuis **Employés**.

## Déploiement Vercel

1. Pousser le dépôt sur GitHub puis l'importer dans Vercel.
2. Renseigner les variables d'environnement (*Settings → Environment Variables*) : celles de `.env.example`, avec `NEXT_PUBLIC_SITE_URL` = URL de production et un `CRON_SECRET` long et aléatoire.
3. Déployer. La tâche planifiée `vercel.json` appelle `/api/cron/notifications` chaque jour à 05:00 UTC (06:00 à Tunis). Vercel envoie automatiquement `Authorization: Bearer <CRON_SECRET>`.
4. Mettre à jour *Site URL* et *Redirect URLs* dans Supabase avec le domaine final.

## Rôles et permissions

La matrice de référence est la table SQL `private.role_permissions` ; l'interface ne fait que masquer ce qui n'est pas autorisé.

| | Propriétaire | Accueil | Coach |
|---|:-:|:-:|:-:|
| Tableau de bord (chiffres financiers) | ✅ | — | — |
| Membres : création, modification, archivage | ✅ | ✅ | — |
| Membres : consultation | tous | tous | **assignés uniquement** |
| Notes internes | ✅ | ✅ | — |
| Export CSV des membres | ✅ | — | — |
| Abonnements : vente, renouvellement | ✅ | ✅ | — |
| Abonnements : suspension, annulation, prolongation | ✅ | — | — |
| Encaissements et reçus | ✅ | ✅ | — |
| Remboursements / annulations de paiement | ✅ | — | — |
| Antidater un paiement | ✅ | — | — |
| Check-in | ✅ | ✅ | — |
| Entrée forcée (dérogation motivée) / correction de présence | ✅ | — | — |
| Présences | toutes | toutes | membres assignés |
| Programmes et progression | tous | lecture | **membres assignés** |
| Planning | tout | tout | ses séances |
| Dépenses, rapports, personnel, paramètres, audit | ✅ | — | — |

Un employé ne peut **jamais** modifier son propre rôle ni se réactiver (trigger SQL), et la salle conserve toujours au moins un propriétaire actif.

## Modèle de sécurité

- **Isolation des salles** : chaque table porte `organization_id` ; chaque politique RLS vérifie que l'utilisateur est employé **actif** de **cette** salle. Les clés étrangères sont composites (`organization_id`, `id`) : impossible de rattacher une donnée d'une salle à une autre, même avec un identifiant deviné.
- **Administrateurs plateforme** : la table `private.platform_admins` n'est consultée par aucune politique ; elle ne donne aucun accès aux données des salles.
- **Écritures sensibles** (abonnements, paiements, remboursements, présences, réservations) : aucune écriture directe autorisée ; elles passent par des fonctions SQL `SECURITY DEFINER` qui vérifient la permission, filtrent par salle, verrouillent les lignes (`FOR UPDATE`) et sont **idempotentes** (`request_id`).
- **Défense en profondeur** : middleware (session) → Server Action (`authorize()` + validation Zod) → RLS / fonction SQL.
- **Stockage** : buckets privés, chemin `<organization_id>/…` vérifié par politique ; affichage par URL signée d'une heure.
- **Anonyme** : aucun droit sur les tables (`revoke all … from anon`).
- **Journal d'audit** : paiements, remboursements, abonnements (avec motif), présences corrigées ou forcées, personnel, formules, dépenses, paramètres, modifications de fiches membres, exports. Lecture seule, réservé au propriétaire.
- **Données de santé** : mesures et notes de progression visibles uniquement par le propriétaire et le coach assigné ; seules les données utiles au suivi sont collectées.

## Règles financières

- Montants en `numeric(12,3)` en base ; aucun calcul monétaire en virgule flottante côté application (sommes en SQL ou en millimes entiers).
- **Un impayé n'est jamais du chiffre d'affaires** : les rapports reposent uniquement sur les paiements reçus, moins les remboursements à leur date.
- **Un paiement validé n'est ni modifiable ni supprimable** (trigger + privilèges), y compris par le propriétaire : on corrige par **remboursement** (partiel) ou **annulation** (contre-passation totale), avec motif obligatoire.
- Trop-perçus refusés ; remboursement limité au montant restant ; montants à plus de 3 décimales refusés.
- Les abonnements expirés ou annulés ne sont jamais supprimés ni écrasés ; un renouvellement démarre le lendemain de l'abonnement en cours ; deux adhésions qui se chevauchent sont impossibles (contrainte d'exclusion).
- Numéros de reçus séquentiels par salle (`R-2026-000001`), attribués de façon sûre en cas d'accès concurrents.
- Cette version **enregistre** les paiements (espèces, virement, carte via TPE, chèque…) : elle ne traite pas de paiement en ligne.

## Tests

`npm run db:test` recrée une base PostgreSQL locale, applique un bouchon de l'environnement Supabase (`supabase/tests/supabase_stub.sql` : rôles, `auth.uid()`, stockage) puis **toutes** les migrations, et exécute 48 scénarios en se faisant passer pour différents utilisateurs, comme le fait l'API Supabase :

- isolation entre deux salles (lecture, écriture, RPC, accès par identifiant deviné, utilisateur anonyme) ;
- permissions de l'accueil et des coachs ;
- abonnements : création, idempotence, renouvellement, chevauchement, prolongation auditée, suspension/reprise, annulation, expiration ;
- paiements partiels, soldes, trop-perçu, antidatage, immutabilité, remboursements, cohérence du tableau de bord et du compte de résultat ;
- contrôle d'accès à l'entrée, anti-doublon, dérogation ;
- surbooking et double réservation d'un coach ;
- anti auto-promotion, désactivation immédiate ;
- notifications ciblées et idempotentes, exports, stockage.

Variable `TEST_DATABASE_URL` : connexion super-utilisateur à un PostgreSQL 15+ local (par défaut `postgresql://gym:gym@localhost:5432/postgres`).

## Fonctionnalités

- **Tableau de bord** : membres inscrits / actifs / expirés / expirant sous 7 jours, check-ins du jour, inscriptions du mois ; pour le propriétaire : encaissements du jour, du mois et de l'année, soldes impayés, derniers paiements ; graphiques de croissance et d'encaissements ; séances à venir.
- **Membres** : fiche complète (photo, contacts, urgence, coach), n° membre automatique, recherche (nom, téléphone, n°), filtres, pagination, archivage avec motif, détection de doublons, historique (abonnements, paiements, présences, programmes, progression), notes internes, carte membre avec QR code, export CSV.
- **Formules** : abonnements, pass jour/semaine, packs coaching, durée et prix configurables, restrictions d'accès.
- **Abonnements** : vente avec remise et encaissement immédiat, calcul automatique de l'échéance, renouvellement, suspension/reprise (jours gelés reportés), prolongation et annulation motivées, vues « expirent bientôt », « expirés », « impayés ».
- **Paiements** : total ou partiel, moyens configurables, reçu imprimable en français, remboursement/annulation, journal filtrable.
- **Présences** : poste d'accueil (recherche, n° membre, douchette USB, caméra QR si supportée), verdict serveur, dérogation motivée, anti double-scan, sorties, historique par date, corrections auditées.
- **Coachs** : spécialités, disponibilités hebdomadaires, membres assignés, compte utilisateur lié.
- **Programmes** : jours par groupe musculaire, exercices (séries, répétitions, repos, charge, consignes), séances réalisées, mesures de progression.
- **Planning** : semaine, cours collectifs et coaching individuel, répétition hebdomadaire, capacité, réservations, présent/absent, annulation ; pas de surbooking ni de double réservation d'un coach.
- **Prospects** : tunnel Kanban (v1) adapté, conversion en membre.
- **Rapports** : encaissements par jour / semaine / mois / année, par formule, compte de résultat simplifié ; **dépenses** par catégorie avec annulation motivée.
- **Notifications in-app** : expirations, expirés, impayés, séances à venir, nouveaux membres, maintenance, annonces internes ; réglages par salle.
- **Équipements** : inventaire, état, coûts, historique et échéances de maintenance.
- **Personnel** : invitation, rôles, activation/désactivation ; **journal d'audit**.

## Intégrations restant à brancher

| Intégration | État |
|---|---|
| SMS / WhatsApp / email aux membres | **Non connecté.** Les canaux apparaissent « Non configuré » dans les paramètres ; aucune notification externe n'est envoyée. Point d'extension : la tâche `/api/cron/notifications` et la fonction SQL `private.notify`. |
| Paiement en ligne | Hors périmètre (les paiements par carte sont saisis manuellement). |
| Langue arabe | Structure prête (`src/i18n`, `dir="rtl"`), dictionnaire `ar.ts` à rédiger ; une partie des libellés de pages est encore écrite directement en français dans les composants. |
| Types Supabase générés | À générer une fois le projet créé (voir plus haut). |
| Interface « super-admin » plateforme | Création des salles par script (`bootstrap-owner`) ; pas encore d'écran dédié. |

**Testé** : migrations, RLS, isolation multi-salles et règles métier (48 tests sur PostgreSQL local), build de production et vérification TypeScript, écrans de connexion (validation, redirections, affichage mobile).
**Non testé à ce jour** : le parcours complet dans le navigateur avec un vrai projet Supabase (connexion, invitations par email, envoi de photos) — à valider dès que les clés sont configurées.
