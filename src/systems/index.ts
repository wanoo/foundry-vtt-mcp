// systems/index.ts
// Registre des modules système. Par défaut tous les modules embarqués sont
// chargés ; FOUNDRY_SYSTEMS (liste séparée par des virgules) restreint aux
// systèmes voulus, FOUNDRY_SYSTEMS="" les désactive tous.
import type { SystemToolModule } from "./types.js";
import { starwarsffgModule } from "./starwarsffg/index.js";

export const ALL_SYSTEM_MODULES: SystemToolModule[] = [starwarsffgModule];

export function loadSystemModules(env: NodeJS.ProcessEnv = process.env): SystemToolModule[] {
  const wanted = env.FOUNDRY_SYSTEMS;
  if (wanted === undefined) {
    return ALL_SYSTEM_MODULES;
  }
  const ids = new Set(
    wanted.split(",").map((s) => s.trim()).filter(Boolean)
  );
  return ALL_SYSTEM_MODULES.filter((m) => ids.has(m.id));
}

export type { SystemToolModule } from "./types.js";
