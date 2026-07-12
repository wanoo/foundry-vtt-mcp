import {
  FOUNDRY_COOKIE_BINDING_GENERATION,
  parseFoundryGeneration,
  parseGenerationFromVersion,
  usesCookieSessionBinding,
} from "../src/core/version.js";

describe("version detection", () => {
  test("parseGenerationFromVersion extracts the leading generation", () => {
    expect(parseGenerationFromVersion("14.364")).toBe(14);
    expect(parseGenerationFromVersion("13.347")).toBe(13);
    expect(parseGenerationFromVersion("9.280")).toBe(9);
    expect(parseGenerationFromVersion("0.8.9")).toBe(0);
    expect(parseGenerationFromVersion("  12.331 ")).toBe(12);
  });

  test("parseGenerationFromVersion returns null for non-numeric input", () => {
    expect(parseGenerationFromVersion("stable")).toBeNull();
    expect(parseGenerationFromVersion("")).toBeNull();
  });

  test("parseFoundryGeneration reads the version field from /api/status", () => {
    expect(parseFoundryGeneration(JSON.stringify({ active: true, version: "14.364" }))).toBe(14);
    expect(parseFoundryGeneration(JSON.stringify({ version: "13.347" }))).toBe(13);
  });

  test("parseFoundryGeneration prefers an explicit release.generation", () => {
    const body = JSON.stringify({ version: "14.364", release: { generation: 14 } });
    expect(parseFoundryGeneration(body)).toBe(14);
  });

  test("parseFoundryGeneration handles a numeric version", () => {
    expect(parseFoundryGeneration(JSON.stringify({ version: 13 }))).toBe(13);
  });

  test("parseFoundryGeneration returns null for invalid or empty bodies", () => {
    expect(parseFoundryGeneration("not json")).toBeNull();
    expect(parseFoundryGeneration(JSON.stringify({ active: true }))).toBeNull();
    expect(parseFoundryGeneration(JSON.stringify(null))).toBeNull();
    expect(parseFoundryGeneration("[]")).toBeNull();
  });

  test("usesCookieSessionBinding is true only for v14+", () => {
    expect(FOUNDRY_COOKIE_BINDING_GENERATION).toBe(14);
    expect(usesCookieSessionBinding(14)).toBe(true);
    expect(usesCookieSessionBinding(15)).toBe(true);
    expect(usesCookieSessionBinding(13)).toBe(false);
    expect(usesCookieSessionBinding(9)).toBe(false);
    expect(usesCookieSessionBinding(null)).toBe(false);
  });
});
