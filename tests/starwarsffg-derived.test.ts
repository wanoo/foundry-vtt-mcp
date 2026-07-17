import { collectAttributeMods, deriveCharacteristic, deriveSkillPool } from "../src/systems/starwarsffg/derived.js";

// Acteur reproduisant la structure réelle (source à 0 + mods d'espèce/talents).
const ACTOR = {
  _id: "a1",
  name: "Pahas'Tis",
  system: {
    characteristics: {
      Willpower: { value: 0 },
      Cunning: { value: 0 },
    },
    skills: {
      Vigilance: { rank: 0, characteristic: "Willpower" },
      Perception: { rank: 1, characteristic: "Cunning" },
    },
    attributes: {
      bought1: { mod: "Willpower", modtype: "Characteristic", value: 1 }, // achat XP
    },
  },
  items: [
    {
      name: "Twi’lek",
      type: "species",
      system: {
        attributes: {
          W: { mod: "Willpower", modtype: "Characteristic", value: 2, exclude: true },
          C: { mod: "Cunning", modtype: "Characteristic", value: 2, exclude: true },
        },
      },
    },
    {
      name: "Visionnaire",
      type: "specialization",
      system: {
        talents: {
          talent1: {
            name: "Réaction fulgurante",
            islearned: true,
            attributes: {
              a1: { mod: "Vigilance", modtype: "Skill Boost", value: 1 },
              a2: { mod: "Vigilance", modtype: "Skill Boost", value: 1 },
            },
          },
          talent2: {
            name: "Pas appris",
            islearned: false,
            attributes: { x: { mod: "Vigilance", modtype: "Skill Boost", value: 5 } },
          },
          talent3: {
            name: "Œil aiguisé",
            islearned: true,
            attributes: { s: { mod: "Perception", modtype: "Skill Remove Setback", value: 1 } },
          },
          talent4: {
            name: "Maîtrise",
            islearned: true,
            attributes: { r: { mod: "Perception", modtype: "Skill Rank", value: 1 } },
          },
        },
      },
    },
    {
      name: "Technique Niman",
      type: "forcepower",
      system: {
        upgrade0: { name: "up", islearned: true, attributes: { w: { modtype: "Stat", mod: "Wounds", value: 1 } } },
        upgrade1: { name: "non", islearned: false, attributes: { w2: { modtype: "Stat", mod: "Wounds", value: 9 } } },
      },
    },
  ],
};

describe("starwarsffg/derived", () => {
  test("collectAttributeMods : acteur + items + talents APPRIS + upgrades APPRIS", () => {
    const mods = collectAttributeMods(ACTOR as any);
    expect(mods.filter((m) => m.modtype === "Skill Boost" && m.mod === "Vigilance")).toHaveLength(2);
    expect(mods.find((m) => m.source.includes("Pas appris"))).toBeUndefined();
    expect(mods.filter((m) => m.modtype === "Stat" && m.mod === "Wounds")).toHaveLength(1);
  });

  test("caractéristique dérivée = stockée + espèce + achats XP", () => {
    expect(deriveCharacteristic(ACTOR as any, "Willpower")).toBe(3); // 0 + 2 (espèce) + 1 (achat)
    expect(deriveCharacteristic(ACTOR as any, "Cunning")).toBe(2);
  });

  test("pool de compétence : jaunes/verts + boosts de talents", () => {
    const p = deriveSkillPool(ACTOR as any, "vigilance"); // insensible à la casse
    expect(p).toMatchObject({
      skill: "Vigilance",
      characteristic: "Willpower",
      characteristicValue: 3,
      rank: 0,
      proficiency: 0,
      ability: 3,
      boost: 2,
    });
    expect(p!.sources.join(" ")).toContain("Réaction fulgurante");
  });

  test("rang dérivé (Skill Rank) et Remove Setback", () => {
    const p = deriveSkillPool(ACTOR as any, "Perception");
    // rang 1 stocké + 1 (talent Maîtrise) = 2 ; Cunning 2 → 2 jaunes, 0 vert
    expect(p).toMatchObject({ rank: 2, characteristicValue: 2, proficiency: 2, ability: 0, removeSetback: 1 });
  });

  test("compétence inconnue → null", () => {
    expect(deriveSkillPool(ACTOR as any, "Basket")).toBeNull();
  });
});
