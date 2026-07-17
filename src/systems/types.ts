// systems/types.ts
// Contrat d'un module « système de jeu » : chaque système (starwarsffg, dnd5e,
// cthulhu, daggerheart…) peut apporter ses outils spécifiques sans toucher au
// cœur générique. Voir systems/README.md pour contribuer un module.
import type { FoundryClient } from "../foundry-client.js";

export type ToolResponse = {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
};

export type ToolRequest = {
  params: { name: string; arguments?: Record<string, unknown> };
};

export interface SystemToolModule {
  /** Foundry system id (match de world.system), e.g. "starwarsffg". */
  id: string;
  label: string;
  /** Définitions d'outils MCP supplémentaires (annotées par le cœur). */
  tools: Array<{ name: string } & Record<string, unknown>>;
  /**
   * Handler des outils du module. Retourne `undefined` si l'outil demandé
   * n'appartient pas au module (le dispatch passe alors au suivant).
   */
  createHandler(
    foundryClient: FoundryClient
  ): (request: ToolRequest) => Promise<ToolResponse | undefined>;
}
