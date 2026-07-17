# System modules — contribute tools for YOUR game system

The MCP core is **system-agnostic**: documents, scenes, tokens, compendia,
playlists, combat, events… work on any Foundry world. Everything specific to a
game system (dice mechanics, stat paths, chat-card formats) lives here, one
module per system, so that adding support for dnd5e, Call of Cthulhu,
Daggerheart, etc. never touches the core.

## Layout

```
src/systems/
  types.ts            the SystemToolModule contract
  index.ts            registry (add your module to ALL_SYSTEM_MODULES)
  starwarsffg/        reference implementation (Star Wars FFG)
    index.ts          tool definitions + handler
    dice.ts           narrative dice evaluation (official faces, injectable rng)
```

## Writing a module

1. Create `src/systems/<system-id>/index.ts` exporting a `SystemToolModule`:
   - `id`: the Foundry system id (`game.system.id`, e.g. `"dnd5e"`).
   - `tools`: MCP tool definitions (annotations are added by the core —
     read-only tools should be named `get_*`/`list_*`).
   - `createHandler(foundryClient)`: returns a handler that answers its own
     tools and returns `undefined` for anything else.
2. Register it in `index.ts` → `ALL_SYSTEM_MODULES`.
3. Add tests (`tests/<system-id>-*.test.ts`) — mock `foundryClient`, see
   `tests/server-tools.test.ts` for the pattern. Dice/math helpers should take
   an injectable `rng` for deterministic tests.
4. Verify the exact system paths against a REAL actor/world before hardcoding
   them (document shapes differ between system versions) — note the system
   version you validated against in a comment.

## Loading

All bundled modules are loaded by default. Deployments can restrict with the
`FOUNDRY_SYSTEMS` env var (comma-separated ids, empty string = none):

```
FOUNDRY_SYSTEMS=starwarsffg
```

Useful client tools available to your handlers: `getDocument`/`getDocuments`
(fresh per-collection reads, `where` filters), `modifyDocument`/`createDocument`
(dotted-key updates, embedded via `parentUuid`), `getUserId()` (for ChatMessage
`author`, required since Foundry v13), `emitWithAck`/`emitEvent` (raw socket).
