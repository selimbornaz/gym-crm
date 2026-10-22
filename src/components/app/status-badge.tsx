import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { t } from "@/i18n";

const MEMBERSHIP: Record<string, BadgeVariant> = {
  active: "success", expiring: "warning", expired: "danger", suspended: "info", none: "outline", archived: "secondary",
};
const SUBSCRIPTION: Record<string, BadgeVariant> = {
  active: "success", scheduled: "info", expired: "danger", suspended: "warning", cancelled: "secondary",
};
const PAYMENT: Record<string, BadgeVariant> = { paid: "success", partial: "warning", unpaid: "danger" };

/** Badges de statut : teinte translucide + pastille + libellé (jamais la couleur seule). */
export function MembershipBadge({ status }: { status: string }) {
  return (
    <Badge variant={MEMBERSHIP[status] ?? "outline"} dot>
      {t.membershipStatus[status as keyof typeof t.membershipStatus] ?? status}
    </Badge>
  );
}

export function SubscriptionBadge({ status }: { status: string }) {
  return (
    <Badge variant={SUBSCRIPTION[status] ?? "outline"} dot>
      {t.subscriptionStatus[status as keyof typeof t.subscriptionStatus] ?? status}
    </Badge>
  );
}

export function PaymentBadge({ status }: { status: string }) {
  return (
    <Badge variant={PAYMENT[status] ?? "outline"} dot>
      {t.paymentStatus[status as keyof typeof t.paymentStatus] ?? status}
    </Badge>
  );
}
