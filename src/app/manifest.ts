import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "GymPulse AI — Gym tracker",
    short_name: "GymPulse",
    description: "A personal workout journal and fitness analytics dashboard.",
    start_url: "/",
    display: "standalone",
    background_color: "#101310",
    theme_color: "#101310",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "maskable" }],
  };
}
