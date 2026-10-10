import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "AkibaMiles Admin",
    short_name: "AkibaMiles Admin",
    description: "Internal AkibaMiles admin dashboard",
    start_url: "/overview",
    display: "standalone",
    background_color: "#F6F8FA",
    theme_color: "#0F766E",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/icon-512-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
