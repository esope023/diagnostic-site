import { defineConfig } from "vite";

// `base` doit correspondre au nom du repo pour un déploiement GitHub Pages.
// Ex. repo "Analyse" -> base "/Analyse/". En dev, laisser "/".
export default defineConfig({
  base: process.env.GH_PAGES_BASE ?? "/",
  build: {
    target: "es2021",
    sourcemap: true,
  },
});
