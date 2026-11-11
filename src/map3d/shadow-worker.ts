// Calcul des ombres hors du fil principal : le curseur d'heure reste fluide,
// même sur téléphone. Les bâtiments sont transmis une fois par site ; chaque
// demande ne porte ensuite que la position du soleil.

import { computeShadows, type ShadowBuilding, type ShadowResult } from "./shadows";

export type ShadowRequest =
  | { kind: "buildings"; buildings: ShadowBuilding[]; lat0: number; lon0: number }
  | { kind: "compute"; id: number; elevationDeg: number; azimuthDeg: number };

export type ShadowResponse = { id: number; result: ShadowResult };

let state: { buildings: ShadowBuilding[]; lat0: number; lon0: number } | null = null;

self.onmessage = (e: MessageEvent<ShadowRequest>) => {
  const msg = e.data;
  if (msg.kind === "buildings") {
    state = { buildings: msg.buildings, lat0: msg.lat0, lon0: msg.lon0 };
    return;
  }
  if (!state) return;
  const result = computeShadows(state.buildings, state.lat0, state.lon0, msg.elevationDeg, msg.azimuthDeg);
  (self as unknown as Worker).postMessage({ id: msg.id, result } satisfies ShadowResponse);
};
