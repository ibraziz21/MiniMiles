import { PLAY_STORE_URL } from "@/constants/links";
import type { MetadataRoute } from "next";

// PWA manifest — makes Akiba Pass installable from Android Chrome
// ("Add to Home screen") with the Akiba logo, standalone display, and
// brand theming. The Android app is related; the PWA remains installable.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "AkibaMiles",
    short_name: "Akiba",
    description:
      "Earn AkibaMiles at participating merchants, then use your Miles for vouchers and rewards.",
    start_url: "/",
    related_applications: [{ platform: "play", id: "com.akibamiles.akiba", url: PLAY_STORE_URL }],
    prefer_related_applications: false,
    display: "standalone",
    background_color: "#FCFCFC",
    theme_color: "#238D9D",
    orientation: "portrait",
    categories: ["lifestyle", "rewards"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      {
        name: "My Pass",
        short_name: "Pass",
        description: "Show your Akiba Pass at the till",
        url: "/me",
        icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }],
      },
      {
        name: "Games",
        url: "/games",
        icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }],
      },
    ],
  };
}
