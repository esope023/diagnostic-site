// Récupération des données vent via Open-Meteo (archive ERA5, horaire).
// Fenêtre volontairement plus courte que le module Climat : le vent n'a de
// sens qu'en horaire, et 30 ans d'horaire = ~260k points/variable, trop lourd
// à télécharger/cacher pour une simple rose des vents. 10 ans est un
// compromis raisonnable (documenté dans l'export, pas caché).
import { fetchJson } from "../../api/client";
import { OPEN_METEO } from "../../api/endpoints";
import type { SiteContext } from "../../core/types";

export interface VentRaw {
  hourly: {
    time: string[];
    winddirection_10m: number[];
    windspeed_10m: number[];
  };
}

const YEARS_BACK = 10;

export async function fetchVent(ctx: SiteContext): Promise<VentRaw> {
  const end = new Date();
  end.setDate(end.getDate() - 5); // marge de sécurité (délai de mise à jour ERA5)
  const start = new Date(end);
  start.setFullYear(start.getFullYear() - YEARS_BACK);

  const fmt = (d: Date) => d.toISOString().slice(0, 10);

  const url =
    `${OPEN_METEO.archive}?latitude=${ctx.lat}&longitude=${ctx.lon}` +
    `&start_date=${fmt(start)}&end_date=${fmt(end)}` +
    `&hourly=winddirection_10m,windspeed_10m` +
    `&timezone=${encodeURIComponent(ctx.timezone)}`;

  return fetchJson<VentRaw>(url, {
    cacheKey: `open-meteo:vent-${YEARS_BACK}ans`,
    ttlMs: 90 * 24 * 60 * 60 * 1000,
    timeoutMs: 40_000,
  });
}
