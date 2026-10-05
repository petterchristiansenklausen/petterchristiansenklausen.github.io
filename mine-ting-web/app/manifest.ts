import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Mine Ting",
    short_name: "Mine Ting",
    description: "Finn igjen det du eier – og gjør det enklere å selge.",
    start_url: "/",
    display: "standalone",
    background_color: "#D3EBFF",
    theme_color: "#D3EBFF",
    lang: "nb",
    orientation: "portrait-primary",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }
    ]
  };
}
