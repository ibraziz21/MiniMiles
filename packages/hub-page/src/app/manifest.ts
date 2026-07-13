import type { MetadataRoute } from "next";

// PWA manifest — makes Akiba Pass installable from Android Chrome
// ("Add to Home screen") with the Akiba logo, standalone display, and
// brand theming. No native app required.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "AkibaMiles",
    short_name: "Akiba",
    description:
      "Shop from merchants, earn AkibaMiles, claim rewards, and show your Akiba Pass in-store.",
    start_url: "/",
    display: "standalone",
    background_color: "#FCFCFC",
    theme_color: "#238D9D",
    orientation: "portrait",
    categories: ["shopping", "lifestyle"],
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
        name: "Rewards",
        url: "/rewards",
        icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }],
      },
    ],
  };
}
