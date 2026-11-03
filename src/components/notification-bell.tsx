import { Bell } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { fetchMyBlockerNotifications, markBlockerNotificationRead } from "@/lib/blocker-circuit";
import { timeAgo } from "@/lib/dashboard";

/** Cloche minimale (R9) : icône + badge non lus, liste des notifications de points bloquants,
 * marquer comme lu au clic, lien vers le tableau de bord (/) ancré sur le point concerné
 * (#blocker-<id>) — aucune fiche dédiée n'existe. */
export function NotificationBell({ email }: { email: string }) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["blocker_notifications", "mine", email],
    queryFn: fetchMyBlockerNotifications,
    enabled: !!email,
  });

  const notifications = q.data ?? [];
  const unreadCount = notifications.filter((n) => !n.read_at).length;

  function handleOpen(id: string) {
    if (notifications.find((n) => n.id === id)?.read_at) return;
    markBlockerNotificationRead(id)
      .then(() => qc.invalidateQueries({ queryKey: ["blocker_notifications", "mine", email] }))
      .catch(() => {
        // Jamais bloquant pour la navigation : au pire la notification reste non lue.
      });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} non lue(s)` : "Notifications"}
        className="relative inline-flex items-center justify-center p-xs text-on-surface-variant hover:text-primary focus:outline-none"
      >
        <Bell size={20} strokeWidth={1.5} aria-hidden="true" />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-[16px] px-1 rounded-full bg-error text-on-primary text-[10px] font-label-sm leading-[16px] text-center">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <DropdownMenuLabel className="font-label-sm text-label-sm uppercase text-on-surface-variant">
          Points bloquants
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {notifications.length === 0 ? (
          <p className="px-sm py-sm font-body-sm text-body-sm text-on-surface-variant">
            Aucune notification pour l'instant.
          </p>
        ) : (
          notifications.map((n) => (
            <DropdownMenuItem key={n.id} asChild onSelect={() => handleOpen(n.id)}>
              <Link to="/" hash={n.blocker_id ? `blocker-${n.blocker_id}` : undefined} className="flex-col items-start gap-0.5 whitespace-normal">
                <span className={`font-body-sm text-body-sm ${n.read_at ? "text-on-surface-variant" : "text-primary font-bold"}`}>
                  {n.message}
                </span>
                <span className="font-label-sm text-label-sm text-on-surface-variant">{timeAgo(n.created_at)}</span>
              </Link>
            </DropdownMenuItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
