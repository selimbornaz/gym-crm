"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

/**
 * Vidéo d'intro de l'écran de connexion : lue une seule fois, sans son, puis
 * figée sur sa dernière image (pas de boucle). Si l'utilisateur demande moins
 * d'animations, on affiche directement la dernière image.
 */
export function LoginIntroVideo({ className }: { className?: string }) {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      const showLastFrame = () => {
        video.currentTime = Math.max(video.duration - 0.05, 0);
      };
      if (video.readyState >= 1) showLastFrame();
      else video.addEventListener("loadedmetadata", showLastFrame, { once: true });
      return;
    }
    // Lecture en douceur : certains navigateurs ignorent autoPlay sur un rendu serveur.
    video.play().catch(() => {});
  }, []);

  return (
    <video
      ref={ref}
      src="/brand/login-intro.mp4"
      muted
      playsInline
      autoPlay
      preload="auto"
      disablePictureInPicture
      disableRemotePlayback
      aria-label="Dopamine Fitness"
      className={cn("pointer-events-none aspect-square h-auto w-full select-none bg-black object-contain", className)}
    />
  );
}
