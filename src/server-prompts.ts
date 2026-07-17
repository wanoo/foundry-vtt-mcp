// server-prompts.ts
// Prompts MCP prédéfinis : des gabarits MJ qui injectent l'état LIVE du monde
// (prompts/list + prompts/get). Les clients les proposent comme raccourcis.
import type { FoundryClient } from "./foundry-client.js";
import { htmlToMarkdown } from "./core/markdown.js";

export const PROMPT_DEFINITIONS = [
  {
    name: "session-recap",
    description:
      "Résumer la dernière séance à partir des messages de chat récents (jets, actions, décisions).",
    arguments: [
      {
        name: "max_messages",
        description: "Nombre de messages de chat à considérer (défaut 50)",
        required: false,
      },
    ],
  },
  {
    name: "world-overview",
    description:
      "Brief de l'état du monde : scène active, combats en cours, dernières notes — pour se remettre dans le bain avant de préparer.",
    arguments: [],
  },
  {
    name: "prep-checklist",
    description:
      "Vérifier la préparation d'une scène : tokens posés, playlists disponibles, journaux liés — et lister ce qui manque.",
    arguments: [
      { name: "scene", description: "Nom ou _id de la scène (défaut : scène active)", required: false },
    ],
  },
];

export function createPromptHandlers(foundryClient: FoundryClient) {
  async function get(name: string, args: Record<string, string> | undefined) {
    if (name === "session-recap") {
      const max = parseInt(args?.max_messages ?? "50", 10) || 50;
      const messages = (await foundryClient.getDocuments("messages", {})) as Record<string, unknown>[];
      const recent = messages.slice(-max).map((m) => {
        const flavor = (m.flavor as string) || "";
        const content = htmlToMarkdown((m.content as string) ?? "");
        return `- ${flavor ? `[${flavor}] ` : ""}${content}`.slice(0, 500);
      });
      return {
        description: `Résumé de séance sur les ${recent.length} derniers messages`,
        messages: [
          {
            role: "user" as const,
            content: {
              type: "text" as const,
              text:
                `Voici les ${recent.length} derniers messages du chat de notre partie Star Wars FFG (du plus ancien au plus récent) :\n\n` +
                recent.join("\n") +
                `\n\nRédige un résumé de séance structuré : événements marquants, jets décisifs, décisions des joueurs, fils narratifs ouverts.`,
            },
          },
        ],
      };
    }

    if (name === "world-overview") {
      const status = await foundryClient.getStatus();
      const scenes = (await foundryClient.getDocuments("scenes", {
        where: { active: true },
        requestedFields: ["_id", "name"],
      })) as Record<string, unknown>[];
      const combats = (await foundryClient.getDocuments("combats", {})) as Record<string, unknown>[];
      const server = (status.server as Record<string, unknown>) ?? {};
      return {
        description: "Brief de l'état du monde",
        messages: [
          {
            role: "user" as const,
            content: {
              type: "text" as const,
              text:
                `État du monde Foundry « ${server.world ?? "?"} » (${server.system ?? "?"} — v${server.version ?? "?"}) :\n` +
                `- Scène active : ${scenes[0]?.name ?? "aucune"}\n` +
                `- Combats en cours : ${combats.length}\n` +
                `- Joueurs connectés : ${server.users ?? "?"}\n\n` +
                `Fais-moi un brief de reprise : où en est la partie, et qu'est-ce qui mérite mon attention de MJ ?`,
            },
          },
        ],
      };
    }

    if (name === "prep-checklist") {
      const sceneArg = args?.scene;
      const scene = sceneArg
        ? await foundryClient.getDocument("scenes", { _id: sceneArg, name: sceneArg }, { requestedFields: ["_id", "name", "tokens"] })
        : ((await foundryClient.getDocuments("scenes", { where: { active: true }, requestedFields: ["_id", "name", "tokens"] })) as Record<string, unknown>[])[0];
      const tokens = ((scene?.tokens as Record<string, unknown>[] | undefined) ?? []).map((t) => t.name);
      const playlists = (await foundryClient.getDocuments("playlists", {
        requestedFields: ["_id", "name"],
      })) as Record<string, unknown>[];
      return {
        description: `Checklist de préparation — ${scene?.name ?? "scène inconnue"}`,
        messages: [
          {
            role: "user" as const,
            content: {
              type: "text" as const,
              text:
                `Préparation de la scène « ${scene?.name ?? "?"} » :\n` +
                `- Tokens posés (${tokens.length}) : ${tokens.join(", ") || "aucun"}\n` +
                `- Playlists disponibles : ${playlists.map((p) => p.name).join(", ") || "aucune"}\n\n` +
                `Analyse cette préparation : qu'est-ce qui manque probablement (adversaires, ambiance, handouts, éclairage) pour jouer cette scène confortablement ?`,
            },
          },
        ],
      };
    }

    throw new Error(`Unknown prompt: ${name}`);
  }

  return { get };
}
