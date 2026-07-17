import type { FoundryClient } from "./foundry-client.js";
import { canUseIndex } from "./core/collections.js";
import { filterDocumentsByWhere } from "./core/document-utils.js";
import { rollFfgPool, formatPool, formatResult, type FfgPool } from "./core/ffg-dice.js";

export interface DocumentTypeConfig {
  singular: string;
  plural: string;
  collection: string;
  description: string;
}

export const DOCUMENT_TYPES: DocumentTypeConfig[] = [
  { singular: "actor", plural: "actors", collection: "actors", description: "actor" },
  { singular: "item", plural: "items", collection: "items", description: "item" },
  { singular: "folder", plural: "folders", collection: "folders", description: "folder" },
  { singular: "user", plural: "users", collection: "users", description: "user" },
  { singular: "scene", plural: "scenes", collection: "scenes", description: "scene" },
  { singular: "journal", plural: "journals", collection: "journal", description: "journal entry" },
  { singular: "macro", plural: "macros", collection: "macros", description: "macro" },
  { singular: "card", plural: "cards", collection: "cards", description: "card" },
  { singular: "playlist", plural: "playlists", collection: "playlists", description: "playlist" },
  { singular: "table", plural: "tables", collection: "tables", description: "table" },
  { singular: "combat", plural: "combats", collection: "combats", description: "combats" },
  { singular: "message", plural: "messages", collection: "messages", description: "messages" },
  { singular: "setting", plural: "settings", collection: "settings", description: "settings" },
];

export function generateListToolDefinition(config: DocumentTypeConfig) {
  return {
    name: `get_${config.plural}`,
    description: `Get all ${config.plural} from FoundryVTT`,
    inputSchema: {
      type: "object",
      properties: {
        max_length: {
          type: "integer",
          description: `Maximum number of bytes the JSON response can be. ${config.plural.charAt(0).toUpperCase() + config.plural.slice(1)} are removed one by one until under this limit. If 0, undefined, or null, there is no limit.`,
        },
        requested_fields: {
          type: "array",
          items: { type: "string" },
          description: `Array of field names to include in each ${config.description} object. Always includes _id and name. If empty, undefined, or null, all fields are included.`,
        },
        where: {
          type: "object",
          additionalProperties: true,
          description: `Filter ${config.plural} by field values (AND logic). Keys support dotted paths into nested objects and operator suffixes: "field__in" (value must be an array), "field__contains" (case-insensitive substring, or array membership), "field__ne" (not equal), "field__exists" (true/false). Examples: {"folder": "abc123"}, {"flags.campaign-codex.type": "npc"}, {"name__contains": "riar"}, {"_id__in": ["a1", "b2"]}.`,
        },
      },
      required: [],
    },
  };
}

export function generateGetToolDefinition(config: DocumentTypeConfig) {
  return {
    name: `get_${config.singular}`,
    description: `Get a specific ${config.description} from FoundryVTT by id, _id, or name`,
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: `The id of the ${config.description} to retrieve`,
        },
        _id: {
          type: "string",
          description: `The _id of the ${config.description} to retrieve`,
        },
        name: {
          type: "string",
          description: `The name of the ${config.description} to retrieve`,
        },
        requested_fields: {
          type: "array",
          items: { type: "string" },
          description: `Array of field names to include in the ${config.description} object. Always includes _id and name. If empty, undefined, or null, all fields are included.`,
        },
      },
      required: [],
    },
  };
}

export const modifyDocumentTool = {
  name: "modify_document",
  description: `Modify a document in FoundryVTT. IMPORTANT: Before using this tool, you should first retrieve the document using the appropriate get_* tool (e.g., get_actor, get_item) to understand its current structure and field names. Document schemas vary by game system, so inspecting the document first ensures you use the correct field paths in your updates.`,
  inputSchema: {
    type: "object",
    properties: {
      type: {
        type: "string",
        description: `The document type to modify. Valid types include: "Actor", "Item", "Scene", "JournalEntry", "Folder", "User", "Playlist", "Macro", "RollTable", "Cards", "ChatMessage", "Combat", "Combatant", "ActiveEffect", "Drawing", "MeasuredTemplate", "Note", "Tile", "Token", "Wall", "AmbientLight", "AmbientSound". The type must match Foundry's internal document class name (case-sensitive).`,
      },
      _id: {
        type: "string",
        description: `The _id of the document to modify. This is the unique identifier for the document in FoundryVTT.`,
      },
      updates: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: true,
        },
        description: `An array of update objects to apply to the document. Each update object should contain the fields you want to modify, using nested objects to represent the document structure. The _id will be automatically added to each update object.

Example: To update an Actor's strength attribute, you might use:
[{ "system": { "attributes_physical": { "strength": { "value": 5 } } } }]

Example: To update an Item's description and quantity:
[{ "system": { "description": "A shiny sword", "quantity": 2 } }]

The exact field structure depends on the game system. Use the get_* tools first to inspect the document's current structure and determine the correct field paths.`,
      },
      parent_uuid: {
        type: "string",
        description: `Optional. The UUID of the parent document for embedded documents. Required when modifying embedded documents like Drawings, Tokens, Tiles, Walls, etc. that exist within a parent document (e.g., a Scene). Format: "{ParentType}.{parentId}" (e.g., "Scene.vrKkbtn8u66mv1Y9").`,
      },
      pack: {
        type: "string",
        description: `Optional. The compendium pack ID containing the document to modify (e.g., "world.my-compendium"). If not provided, modifies a world document. Use this to update documents within a compendium.`,
      },
    },
    required: ["type", "_id", "updates"],
  },
};

export const createDocumentTool = {
  name: "create_document",
  description: `Create a new document in FoundryVTT. IMPORTANT: Before using this tool, you should first retrieve an existing document of the same type using the appropriate get_* tool (e.g., get_actor, get_item) to understand the expected schema and field structure. Document schemas vary significantly by game system, so inspecting an existing document first ensures you provide the correct fields when creating a new one.`,
  inputSchema: {
    type: "object",
    properties: {
      type: {
        type: "string",
        description: `The document type to create. Valid types include: "Actor", "Item", "Scene", "JournalEntry", "Folder", "User", "Playlist", "Macro", "RollTable", "Cards", "ChatMessage", "Combat", "Combatant", "ActiveEffect", "Drawing", "MeasuredTemplate", "Note", "Tile", "Token", "Wall", "AmbientLight", "AmbientSound". The type must match Foundry's internal document class name (case-sensitive).`,
      },
      data: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: true,
        },
        description: `An array of data objects defining the new documents to create. Each object should contain all required fields for the document type. At minimum, most documents require a "name" field.

Example: To create a simple Item:
[{ "name": "Healing Potion", "type": "consumable" }]

Example: To create an Actor with some system data:
[{ "name": "Goblin", "type": "npc", "system": { "attributes": { "hp": { "value": 10, "max": 10 } } } }]

The exact field structure depends on the game system. Use the get_* tools first to retrieve an existing document of the same type to understand the expected schema.`,
      },
      parent_uuid: {
        type: "string",
        description: `Optional. The UUID of the parent document for embedded documents. Required when creating embedded documents like Drawings, Tokens, Tiles, Walls, etc. within a parent document (e.g., a Scene). Format: "{ParentType}.{parentId}" (e.g., "Scene.vrKkbtn8u66mv1Y9").`,
      },
      pack: {
        type: "string",
        description: `Optional. The compendium pack ID to create the document in (e.g., "world.my-compendium"). If not provided, the document is created in the world. Use this to add documents directly to a compendium.`,
      },
      keep_id: {
        type: "boolean",
        description: `Optional. If true, preserve the "_id" fields provided in the data objects (and in embedded documents such as journal pages) instead of generating new ids. Useful to keep @UUID links valid when re-importing documents.`,
      },
    },
    required: ["type", "data"],
  },
};

export const getPackDocumentsTool = {
  name: "get_pack_documents",
  description: `Read documents from a compendium pack. Unlike the get_* tools (which only read world collections), this reads the contents of a compendium (e.g., "world.my-compendium"). Returns full documents unless requested_fields is provided.`,
  inputSchema: {
    type: "object",
    properties: {
      type: {
        type: "string",
        description: `The primary document type of the pack (e.g., "JournalEntry", "Item", "Actor", "RollTable", "Macro"). Must match the pack's declared type.`,
      },
      pack: {
        type: "string",
        description: `The compendium pack ID to read (e.g., "world.my-compendium").`,
      },
      query: {
        type: "object",
        additionalProperties: true,
        description: `Optional Foundry query object to filter documents (e.g., {"name": "My Entry"}). Default: all documents.`,
      },
      requested_fields: {
        type: "array",
        items: { type: "string" },
        description: `Optional. Field names to include in each document (always includes _id and name). Use ["_id","name"] for a light index.`,
      },
      max_length: {
        type: "number",
        description: `Optional. Maximum bytes for the JSON response; documents are dropped until under the limit.`,
      },
    },
    required: ["type", "pack"],
  },
};

export const getWorldTool = {
  name: "get_world",
  description: `Get world metadata from FoundryVTT. Returns information about the world such as title, system, version, and other metadata. This excludes document collections (actors, items, scenes, etc.) - use the specific get_* tools for those.`,
  inputSchema: {
    type: "object",
    properties: {},
    required: [],
  },
};

export const deleteDocumentTool = {
  name: "delete_document",
  description: `Delete one or more documents in FoundryVTT. This action is permanent and cannot be undone. Use with caution.`,
  inputSchema: {
    type: "object",
    properties: {
      type: {
        type: "string",
        description: `The document type to delete. Valid types include: "Actor", "Item", "Scene", "JournalEntry", "Folder", "User", "Playlist", "Macro", "RollTable", "Cards", "ChatMessage", "Combat", "Combatant", "ActiveEffect", "Drawing", "MeasuredTemplate", "Note", "Tile", "Token", "Wall", "AmbientLight", "AmbientSound". The type must match Foundry's internal document class name (case-sensitive).`,
      },
      ids: {
        type: "array",
        items: {
          type: "string",
        },
        description: `An array of document _ids to delete. Each _id is the unique identifier for a document in FoundryVTT.

Example: To delete a single document:
["vlcf6AI5FaE9qjgJ"]

Example: To delete multiple documents:
["vlcf6AI5FaE9qjgJ", "abc123def456", "xyz789ghi012"]`,
      },
      parent_uuid: {
        type: "string",
        description: `Optional. The UUID of the parent document for embedded documents. Required when deleting embedded documents like Drawings, Tokens, Tiles, Walls, etc. from a parent document (e.g., a Scene). Format: "{ParentType}.{parentId}" (e.g., "Scene.vrKkbtn8u66mv1Y9").`,
      },
      pack: {
        type: "string",
        description: `Optional. The compendium pack ID containing the documents to delete (e.g., "world.my-compendium"). If not provided, deletes world documents. Use this to remove documents from a compendium.`,
      },
    },
    required: ["type", "ids"],
  },
};

export const showCredentialsTool = {
  name: "show_credentials",
  description: `Show all configured Foundry credentials without revealing passwords. Returns the _id, hostname, userid, item_order (zero-based index), and currently_active status for each credential entry. Use this to see which Foundry instances are available and which one is currently connected.`,
  inputSchema: {
    type: "object",
    properties: {},
    required: [],
  },
};

export const chooseFoundryInstanceTool = {
  name: "choose_foundry_instance",
  description: `Switch to a different Foundry instance. Disconnects from the current instance (if any) and connects to the specified one. You can identify the instance either by item_order (zero-based index) or by _id (the name of the credential entry). Use show_credentials first to see available instances.`,
  inputSchema: {
    type: "object",
    properties: {
      item_order: {
        type: "integer",
        description: `The zero-based index of the credential in the foundry_credentials.json array. Use show_credentials to see the item_order for each instance.`,
      },
      _id: {
        type: "string",
        description: `The _id (name) of the credential entry. This is the user-defined identifier in the foundry_credentials.json file.`,
      },
    },
    required: [],
  },
};

export const uploadFileTool = {
  name: "upload_file",
  description: `Upload a file to FoundryVTT. You must provide EXACTLY ONE of 'url' or 'image_data' (XOR logic). If you provide both or neither, the request will fail.

- Use 'url' to download and upload a file from a remote URL (e.g., an image URL from the web)
- Use 'image_data' to upload base64-encoded file content directly

The file will be uploaded to the specified target directory in FoundryVTT's data storage.`,
  inputSchema: {
    type: "object",
    properties: {
      target: {
        type: "string",
        description: `The target directory path in FoundryVTT where the file should be uploaded. Example: "worlds/myworld/assets/avatars" or "worlds/myworld/assets/scenes"`,
      },
      filename: {
        type: "string",
        description: `The filename to use for the uploaded file (including extension). Example: "goblin-avatar.png"`,
      },
      url: {
        type: "string",
        description: `URL to download the file from. The file will be downloaded and then uploaded to FoundryVTT. Cannot be used together with 'image_data'.`,
      },
      image_data: {
        type: "string",
        description: `Base64-encoded file content to upload. Cannot be used together with 'url'.`,
      },
    },
    required: ["target", "filename"],
  },
};

export const browseFilesTool = {
  name: "browse_files",
  description: `Browse files and directories in FoundryVTT's file system. Returns a listing of directories and files at the specified target path, filtered by file type.`,
  inputSchema: {
    type: "object",
    properties: {
      target: {
        type: "string",
        description: `The target directory path to browse. Example: "worlds/myworld/assets" or "worlds/myworld/assets/avatars"`,
      },
      type: {
        type: "string",
        description: `The file type filter. Defaults to "image". Common values: "image", "audio", "video", "text"`,
      },
      extensions: {
        type: "array",
        items: { type: "string" },
        description: `Array of file extensions to filter (with leading dot). Defaults to common image extensions: [".apng", ".avif", ".bmp", ".gif", ".jpeg", ".jpg", ".png", ".svg", ".tiff", ".webp"]`,
      },
    },
    required: ["target"],
  },
};

export const createCompendiumTool = {
  name: "create_compendium",
  description: `Create a new Compendium pack in FoundryVTT. Compendia are collections of documents (Actors, Items, Scenes, etc.) that can be used for organizing and sharing content. The compendium will be created in the current world.`,
  inputSchema: {
    type: "object",
    properties: {
      label: {
        type: "string",
        description: `The display label for the compendium (e.g., "My NPCs", "Custom Items"). This is what users see in the UI.`,
      },
      type: {
        type: "string",
        description: `The document type this compendium will contain. Valid types: "Actor", "Item", "Scene", "JournalEntry", "Macro", "Playlist", "RollTable", "Cards", "Adventure". All documents in a compendium must be of the same type.`,
      },
    },
    required: ["label", "type"],
  },
};

export const deleteCompendiumTool = {
  name: "delete_compendium",
  description: `Delete a Compendium pack from FoundryVTT. This permanently removes the compendium and all documents it contains. Use with caution.`,
  inputSchema: {
    type: "object",
    properties: {
      name: {
        type: "string",
        description: `The name (not label) of the compendium to delete. This is the lowercase, slugified version of the label (e.g., "my-npcs" for a compendium labeled "My NPCs"). You can find this in the compendium's "id" field (e.g., "world.my-npcs" has name "my-npcs").`,
      },
    },
    required: ["name"],
  },
};

const createDirectoryTool = {
  name: "create_directory",
  description:
    "Create a directory in FoundryVTT's file storage. Useful before upload_file, which cannot create missing folders. The parent directory must already exist (create nested paths one level at a time).",
  inputSchema: {
    type: "object",
    properties: {
      target: {
        type: "string",
        description: `Directory path to create, relative to the storage root (e.g. "worlds/my-world/images/handouts")`,
      },
      source: {
        type: "string",
        description: `Storage source: "data" (default), "public" or "s3"`,
      },
    },
    required: ["target"],
  },
};

const showJournalToPlayersTool = {
  name: "show_journal_to_players",
  description:
    "Show a JournalEntry to connected players, like the GM's 'Show to Players' action. Opens the journal on their screen. By default only players with observe permission see it; use force to override.",
  inputSchema: {
    type: "object",
    properties: {
      _id: { type: "string", description: "The _id of the JournalEntry to show" },
      name: { type: "string", description: "The name of the JournalEntry to show (alternative to _id)" },
      uuid: {
        type: "string",
        description: `Full document uuid (alternative to _id/name), e.g. "JournalEntry.abc123" or a page uuid "JournalEntry.abc123.JournalEntryPage.def456"`,
      },
      force: {
        type: "boolean",
        description: "Show the entry even to players who lack permission to observe it (default false)",
      },
      users: {
        type: "array",
        items: { type: "string" },
        description: "Restrict to these user _ids (default: all connected players)",
      },
    },
  },
};

const shareImageTool = {
  name: "share_image",
  description:
    "Display an image fullscreen to connected players (ImagePopout), like the GM's 'Show to Players' on an image. The image must be reachable by the players' clients (a path in Foundry's storage or a URL).",
  inputSchema: {
    type: "object",
    properties: {
      image: { type: "string", description: `Image path or URL (e.g. "worlds/my-world/images/handout.png")` },
      title: { type: "string", description: "Window title shown above the image" },
      caption: { type: "string", description: "Optional caption displayed with the image" },
      users: {
        type: "array",
        items: { type: "string" },
        description: "Restrict to these user _ids (default: all connected players)",
      },
      show_title: { type: "boolean", description: "Whether the title is visible to players (default true)" },
    },
    required: ["image"],
  },
};

const togglePauseTool = {
  name: "toggle_pause",
  description: "Pause or unpause the game for all connected players (requires the logged-in user to be a GM).",
  inputSchema: {
    type: "object",
    properties: {
      paused: { type: "boolean", description: "true to pause the game, false to resume it" },
    },
    required: ["paused"],
  },
};

const activateSceneTool = {
  name: "activate_scene",
  description:
    "Set a scene as the currently active scene (the one players see). Optionally pull connected users to it.",
  inputSchema: {
    type: "object",
    properties: {
      _id: { type: "string", description: "The _id of the scene to activate" },
      name: { type: "string", description: "The name of the scene to activate (alternative to _id)" },
      pull_users: {
        type: "boolean",
        description: "Also pull all users to the scene after activating it (default false)",
      },
    },
  },
};

const pullUsersToSceneTool = {
  name: "pull_users_to_scene",
  description:
    "Pull connected users to a scene (their client switches to viewing it). Does not change the active scene.",
  inputSchema: {
    type: "object",
    properties: {
      _id: { type: "string", description: "The _id of the target scene" },
      name: { type: "string", description: "The name of the target scene (alternative to _id)" },
      users: {
        type: "array",
        items: { type: "string" },
        description: "User _ids to pull (default: every user of the world except the one this client is logged in as)",
      },
    },
  },
};

const searchJournalsTool = {
  name: "search_journals",
  description:
    "Full-text search across journal names and page contents (HTML stripped, case-insensitive). Returns lightweight hits: journal _id/name, matching page, and a snippet around the match. Much cheaper than fetching all journals.",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "The text to search for" },
      max_results: { type: "number", description: "Maximum number of hits to return (default 20)" },
    },
    required: ["query"],
  },
};

const listCompendiumPacksTool = {
  name: "list_compendium_packs",
  description:
    "List the compendium packs available in the world (id, label, document type, system). Use the id (e.g. \"world.my-npcs\") with get_pack_documents or import_from_compendium.",
  inputSchema: { type: "object", properties: {} },
};

const importFromCompendiumTool = {
  name: "import_from_compendium",
  description:
    "Import a document from a compendium pack into the world (like dragging it out of the compendium). Finds the document by _id or name in the pack, then creates it as a world document.",
  inputSchema: {
    type: "object",
    properties: {
      pack: { type: "string", description: `The pack id (e.g. "world.my-npcs" or "swffg-astronav.planets")` },
      type: { type: "string", description: `The document type stored in the pack (e.g. "Actor", "Item", "JournalEntry")` },
      _id: { type: "string", description: "The _id of the document inside the pack" },
      name: { type: "string", description: "The name of the document inside the pack (alternative to _id)" },
      keep_id: { type: "boolean", description: "Preserve the pack document's _id in the world (default false)" },
      folder: { type: "string", description: "Optional world folder _id to file the imported document into" },
    },
    required: ["pack", "type"],
  },
};

const listActorOwnershipTool = {
  name: "list_actor_ownership",
  description:
    "List actor ownership: which users own or can observe which actors. Without arguments, lists every actor having non-default permissions; with _id or name, details that actor. Levels: 0=none, 1=limited, 2=observer, 3=owner.",
  inputSchema: {
    type: "object",
    properties: {
      _id: { type: "string", description: "Restrict to the actor with this _id" },
      name: { type: "string", description: "Restrict to the actor with this name" },
    },
  },
};

const setActorOwnershipTool = {
  name: "set_actor_ownership",
  description:
    "Grant or revoke a user's permission on an actor. Level \"none\" removes the user's specific permission (falls back to default). Use user _id or user name.",
  inputSchema: {
    type: "object",
    properties: {
      _id: { type: "string", description: "The _id of the actor" },
      name: { type: "string", description: "The name of the actor (alternative to _id)" },
      user: { type: "string", description: "The user's _id or name" },
      level: {
        type: "string",
        enum: ["none", "limited", "observer", "owner"],
        description: "Permission level to grant (\"none\" revokes)",
      },
      default_level: {
        type: "string",
        enum: ["none", "limited", "observer", "owner"],
        description: "Optionally also set the actor's DEFAULT permission (applies to all users without a specific level)",
      },
    },
  },
};

const getCurrentSceneTool = {
  name: "get_current_scene",
  description: "Get the currently active scene (the one players see).",
  inputSchema: {
    type: "object",
    properties: {
      requested_fields: {
        type: "array",
        items: { type: "string" },
        description: "Fields to include (default: a light summary — _id, name, active, navigation info)",
      },
    },
  },
};

const setSettingTool = {
  name: "set_setting",
  description:
    "Set a world-scoped setting value (upsert: updates the Setting document if the key exists, creates it otherwise). Keys are namespaced like \"module.setting\" or \"system.setting\" — see get_settings.",
  inputSchema: {
    type: "object",
    properties: {
      key: { type: "string", description: `The setting key (e.g. "starwarsffg.dPoolLight")` },
      value: {
        description: "The value to store (any JSON value; it is serialized the way Foundry stores settings)",
      },
    },
    required: ["key", "value"],
  },
};

const listTokensTool = {
  name: "list_tokens",
  description:
    "List the tokens placed on a scene (position, actor, visibility). Defaults to the currently active scene.",
  inputSchema: {
    type: "object",
    properties: {
      scene_id: { type: "string", description: "Scene _id (default: the active scene)" },
      scene_name: { type: "string", description: "Scene name (alternative to scene_id)" },
    },
  },
};

const moveTokenTool = {
  name: "move_token",
  description:
    "Move a token on a scene to new pixel coordinates (top-left origin; one grid square is usually 100px). Players see the token move.",
  inputSchema: {
    type: "object",
    properties: {
      token: { type: "string", description: "Token _id or name" },
      x: { type: "number", description: "New x position in pixels" },
      y: { type: "number", description: "New y position in pixels" },
      elevation: { type: "number", description: "Optional new elevation" },
      scene_id: { type: "string", description: "Scene _id (default: the active scene)" },
      scene_name: { type: "string", description: "Scene name (alternative to scene_id)" },
    },
    required: ["token"],
  },
};

const updateTokenTool = {
  name: "update_token",
  description:
    "Update arbitrary fields of a token on a scene (hidden, disposition, name, texture, light...). For position use move_token.",
  inputSchema: {
    type: "object",
    properties: {
      token: { type: "string", description: "Token _id or name" },
      updates: {
        type: "object",
        additionalProperties: true,
        description: `Fields to update, e.g. {"hidden": true} or {"disposition": -1}`,
      },
      scene_id: { type: "string", description: "Scene _id (default: the active scene)" },
      scene_name: { type: "string", description: "Scene name (alternative to scene_id)" },
    },
    required: ["token", "updates"],
  },
};

// Core Foundry v13 status effects (CONFIG.statusEffects) — id → {name, img}.
// Stable core data; systems may add their own but these always exist.
const CORE_STATUS_EFFECTS: Record<string, { name: string; img: string }> = {
  dead: { name: "Dead", img: "icons/svg/skull.svg" },
  unconscious: { name: "Unconscious", img: "icons/svg/unconscious.svg" },
  sleep: { name: "Asleep", img: "icons/svg/sleep.svg" },
  stun: { name: "Stunned", img: "icons/svg/daze.svg" },
  prone: { name: "Prone", img: "icons/svg/falling.svg" },
  restrain: { name: "Restrained", img: "icons/svg/net.svg" },
  paralysis: { name: "Paralyzed", img: "icons/svg/paralysis.svg" },
  fly: { name: "Flying", img: "icons/svg/wing.svg" },
  blind: { name: "Blind", img: "icons/svg/blind.svg" },
  deaf: { name: "Deaf", img: "icons/svg/deaf.svg" },
  silence: { name: "Silenced", img: "icons/svg/silenced.svg" },
  fear: { name: "Frightened", img: "icons/svg/terror.svg" },
  burning: { name: "Burning", img: "icons/svg/fire.svg" },
  frozen: { name: "Frozen", img: "icons/svg/frozen.svg" },
  shock: { name: "Shocked", img: "icons/svg/lightning.svg" },
  corrode: { name: "Corroding", img: "icons/svg/acid.svg" },
  bleeding: { name: "Bleeding", img: "icons/svg/blood.svg" },
  disease: { name: "Diseased", img: "icons/svg/biohazard.svg" },
  poison: { name: "Poisoned", img: "icons/svg/poison.svg" },
  curse: { name: "Cursed", img: "icons/svg/sun.svg" },
  regen: { name: "Regenerating", img: "icons/svg/regen.svg" },
  degen: { name: "Degenerating", img: "icons/svg/degen.svg" },
  invisible: { name: "Invisible", img: "icons/svg/invisible.svg" },
  target: { name: "Targeted", img: "icons/svg/target.svg" },
  eye: { name: "Marked", img: "icons/svg/eye.svg" },
  bless: { name: "Blessed", img: "icons/svg/angel.svg" },
};

const toggleActorConditionTool = {
  name: "toggle_actor_condition",
  description:
    `Add or remove a status condition (ActiveEffect) on an actor — shown on its linked tokens. Conditions: ${Object.keys(CORE_STATUS_EFFECTS).join(", ")}. Only works on world actors (linked tokens); unlinked-token deltas are not supported.`,
  inputSchema: {
    type: "object",
    properties: {
      _id: { type: "string", description: "Actor _id" },
      name: { type: "string", description: "Actor name (alternative to _id)" },
      condition: { type: "string", description: `Status id (e.g. "prone", "stun", "bleeding")` },
      active: { type: "boolean", description: "true to add the condition, false to remove it" },
    },
    required: ["condition", "active"],
  },
};

const requestPlayerRollTool = {
  name: "request_player_roll",
  description:
    "Post a Star Wars FFG roll request in chat: a message with a '🎲' button that opens the FFG dice-pool dialog pre-filled for the player who clicks it (system flag ffg-pool-to-player). starwarsffg only.",
  inputSchema: {
    type: "object",
    properties: {
      description: { type: "string", description: `Short label of the check (e.g. "Test de Peur", "Perception moyenne")` },
      content: {
        type: "string",
        description: "Optional HTML shown above the button (context, stakes, spending guide). The button is appended automatically.",
      },
      difficulty: { type: "number", description: "Difficulty dice [di] (default 0)" },
      challenge: { type: "number", description: "Challenge dice [ch] (default 0)" },
      ability: { type: "number", description: "Ability dice [ab] added to the player's pool (default 0)" },
      proficiency: { type: "number", description: "Proficiency dice [pr] (default 0)" },
      boost: { type: "number", description: "Boost dice [bo] (default 0)" },
      setback: { type: "number", description: "Setback dice [se] (default 0)" },
      force: { type: "number", description: "Force dice [fo] (default 0)" },
      skill_name: { type: "string", description: "Skill name displayed in the roll dialog (default: the description)" },
      whisper_users: {
        type: "array",
        items: { type: "string" },
        description: "Optional user _ids to whisper the request to (default: public message)",
      },
    },
    required: ["description"],
  },
};

const controlPlaylistTool = {
  name: "control_playlist",
  description:
    "Play or stop a playlist (or a single sound of it) for everyone — same document updates as Foundry's own play/stop buttons. Modes: sequential/shuffle play one sound, simultaneous plays all.",
  inputSchema: {
    type: "object",
    properties: {
      playlist: { type: "string", description: "Playlist _id or name" },
      action: { type: "string", enum: ["play", "stop"], description: "play or stop" },
      sound: { type: "string", description: "Optional sound _id or name to play specifically" },
    },
    required: ["playlist", "action"],
  },
};

const manageCombatTool = {
  name: "manage_combat",
  description:
    "Manage a combat encounter: create (with tokens from a scene), add_combatants, set_initiative, start, next_turn, next_round, status, end (deletes the combat). Turn order = initiative descending (ties: document order).",
  inputSchema: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["create", "add_combatants", "set_initiative", "start", "next_turn", "next_round", "status", "end"],
      },
      combat_id: { type: "string", description: "Combat _id (default: the first/active combat)" },
      scene_id: { type: "string", description: "create: scene _id (default: the active scene)" },
      tokens: {
        type: "array",
        items: { type: "string" },
        description: "create/add_combatants: token _ids or names (default for create: every token of the scene with an actor)",
      },
      combatant: { type: "string", description: "set_initiative: combatant _id or name" },
      initiative: { type: "number", description: "set_initiative: the initiative value" },
    },
    required: ["action"],
  },
};

const placeTokenTool = {
  name: "place_token",
  description:
    "Place an actor's token on a scene at pixel coordinates, using the actor's prototype token (texture, size, link, disposition).",
  inputSchema: {
    type: "object",
    properties: {
      actor: { type: "string", description: "Actor _id or name" },
      x: { type: "number", description: "x position in pixels" },
      y: { type: "number", description: "y position in pixels" },
      hidden: { type: "boolean", description: "Place the token hidden (default: prototype setting)" },
      scene_id: { type: "string", description: "Scene _id (default: the active scene)" },
      scene_name: { type: "string", description: "Scene name (alternative to scene_id)" },
    },
    required: ["actor", "x", "y"],
  },
};

const rollFfgPoolTool = {
  name: "roll_ffg_pool",
  description:
    "Roll a Star Wars FFG narrative dice pool SERVER-SIDE (official die faces) and post the result to chat. Autonomous — no GM browser needed. For a roll made BY a player, prefer request_player_roll.",
  inputSchema: {
    type: "object",
    properties: {
      description: { type: "string", description: `What the roll is (e.g. "Perception d'Uchebe")` },
      ability: { type: "number" }, proficiency: { type: "number" },
      difficulty: { type: "number" }, challenge: { type: "number" },
      boost: { type: "number" }, setback: { type: "number" }, force: { type: "number" },
      post: { type: "boolean", description: "Post the result to chat (default true)" },
      whisper_users: { type: "array", items: { type: "string" }, description: "Whisper the chat message to these user _ids" },
    },
    required: ["description"],
  },
};

// --- Campaign Codex (fiches = JournalEntry + flags["campaign-codex"]) ----------
// Schéma observé sur le monde (v13, module campaign-codex) : { type, image?, data:{…} }.
const CC_TYPES = ["npc", "group", "location", "region", "shop", "quest", "tag"];
const CC_DATA_DEFAULTS: Record<string, Record<string, unknown>> = {
  npc: { linkedActor: null, description: "", linkedLocations: [], linkedShops: [], associates: [], notes: "", tagMode: false },
  group: { description: "", associates: [] },
  location: { description: "", tags: [], widgets: {} },
  region: { description: "", tags: [] },
  shop: { description: "", linkedNPCs: [], linkedLocation: null, inventory: [], linkedScene: null, markup: 1, notes: "", inventoryCacheVersion: 1 },
  quest: { description: "", associates: [], notes: "" },
  tag: { linkedActor: null, description: "", linkedLocations: [], linkedShops: [], associates: [], notes: "", tagMode: true },
};

const ccListSheetsTool = {
  name: "cc_list_sheets",
  description:
    `List Campaign Codex sheets (journals carrying flags["campaign-codex"]). Filter by type (${CC_TYPES.join("/")}), tag, or name substring. Returns a light index with link counts.`,
  inputSchema: {
    type: "object",
    properties: {
      type: { type: "string", enum: CC_TYPES, description: "Restrict to one sheet type" },
      tag: { type: "string", description: "Restrict to sheets whose data.tags contains this tag" },
      name_contains: { type: "string", description: "Case-insensitive name filter" },
    },
  },
};

const ccGetSheetTool = {
  name: "cc_get_sheet",
  description: "Get one Campaign Codex sheet: type, image, full data (links, tags, notes) and description.",
  inputSchema: {
    type: "object",
    properties: {
      _id: { type: "string", description: "JournalEntry _id" },
      name: { type: "string", description: "Sheet name (alternative to _id)" },
    },
  },
};

const ccCreateSheetTool = {
  name: "cc_create_sheet",
  description:
    "Create a Campaign Codex sheet with the correct flag structure for its type (npc/group/location/region/shop/quest/tag). Adds a text page and observer-by-default visibility unless gm_only.",
  inputSchema: {
    type: "object",
    properties: {
      name: { type: "string", description: "Sheet name" },
      type: { type: "string", enum: CC_TYPES },
      description: { type: "string", description: "HTML description (goes in data.description and the text page)" },
      image: { type: "string", description: "Optional image path/URL for the sheet" },
      linked_actor: { type: "string", description: "npc/tag: actor _id or name to link (data.linkedActor)" },
      tags: { type: "array", items: { type: "string" }, description: "location/region: data.tags" },
      gm_only: { type: "boolean", description: "true = players cannot see it (default false = observer)" },
    },
    required: ["name", "type"],
  },
};

const ccLinkTool = {
  name: "cc_link",
  description:
    "Link two Campaign Codex sheets (or a sheet to an actor). Relations: associates (default), linkedLocations, linkedShops, linkedNPCs, linkedLocation (single), linkedActor (actor). Use bidirectional to also add the reverse 'associates' link.",
  inputSchema: {
    type: "object",
    properties: {
      from: { type: "string", description: "Source sheet _id or name" },
      to: { type: "string", description: "Target sheet _id or name (or actor for linkedActor)" },
      relation: {
        type: "string",
        enum: ["associates", "linkedLocations", "linkedShops", "linkedNPCs", "linkedLocation", "linkedActor"],
        description: "Relation field on the source sheet (default: associates)",
      },
      bidirectional: { type: "boolean", description: "Also add the source to the target's associates (default false)" },
    },
    required: ["from", "to"],
  },
};

const getEventsTool = {
  name: "get_events",
  description:
    "Read the buffer of socket broadcasts received from Foundry (other clients' writes, chat messages, combat updates...). Use since_seq to poll incrementally: note lastSeq, act, then ask for events after it.",
  inputSchema: {
    type: "object",
    properties: {
      since_seq: { type: "number", description: "Only events with seq greater than this (default 0 = all buffered)" },
      event: { type: "string", description: `Filter by socket event name (e.g. "modifyDocument", "pause")` },
      limit: { type: "number", description: "Keep only the N most recent matches" },
    },
  },
};

const waitForMessageTool = {
  name: "wait_for_message",
  description:
    "Block until a new ChatMessage created by ANOTHER client (player roll, GM message) arrives, or until timeout. Returns the message document(s). Flow: note get_events lastSeq → trigger (e.g. request_player_roll) → wait_for_message with that since_seq.",
  inputSchema: {
    type: "object",
    properties: {
      where: {
        type: "object",
        additionalProperties: true,
        description: `Optional filter on the message document (same syntax as get_* where, e.g. {"flags.starwarsffg.description__exists": true})`,
      },
      timeout_seconds: { type: "number", description: "Max wait (default 60, cap 120 — the HTTP proxy cuts long calls)" },
      since_seq: { type: "number", description: "Also scan buffered events after this seq (default: only future events)" },
    },
  },
};

export function createToolDefinitions() {
  return [
    ...DOCUMENT_TYPES.flatMap((config) => [
      generateListToolDefinition(config),
      generateGetToolDefinition(config),
    ]),
    getWorldTool,
    modifyDocumentTool,
    createDocumentTool,
    deleteDocumentTool,
    getPackDocumentsTool,
    showCredentialsTool,
    chooseFoundryInstanceTool,
    uploadFileTool,
    browseFilesTool,
    createCompendiumTool,
    deleteCompendiumTool,
    createDirectoryTool,
    showJournalToPlayersTool,
    shareImageTool,
    togglePauseTool,
    activateSceneTool,
    pullUsersToSceneTool,
    setSettingTool,
    searchJournalsTool,
    listCompendiumPacksTool,
    importFromCompendiumTool,
    listActorOwnershipTool,
    setActorOwnershipTool,
    getCurrentSceneTool,
    listTokensTool,
    moveTokenTool,
    updateTokenTool,
    toggleActorConditionTool,
    requestPlayerRollTool,
    controlPlaylistTool,
    manageCombatTool,
    placeTokenTool,
    rollFfgPoolTool,
    ccListSheetsTool,
    ccGetSheetTool,
    ccCreateSheetTool,
    ccLinkTool,
    getEventsTool,
    waitForMessageTool,
  ];
}

export function errorResponse(message: string) {
  return {
    content: [{ type: "text", text: message }],
    isError: true,
  };
}

export function successResponse(data: unknown) {
  return {
    content: [{ type: "text", text: JSON.stringify(data) }],
  };
}

export function createToolHandler(foundryClient: FoundryClient) {
  return async (request: { params: { name: string; arguments?: Record<string, unknown> } }) => {
    const { name, arguments: args } = request.params;

    const connectionlessTools = ["show_credentials", "choose_foundry_instance"];

    if (!connectionlessTools.includes(name) && !foundryClient.isConnected()) {
      return errorResponse("Error: Not connected to FoundryVTT server");
    }

    for (const config of DOCUMENT_TYPES) {
      if (name === `get_${config.plural}`) {
        try {
          const maxLength = args?.max_length as number | undefined;
          const requestedFields = args?.requested_fields as string[] | undefined;
          const where = args?.where as Record<string, unknown> | undefined;

          const docs = await foundryClient.getDocuments(config.collection, {
            maxLength: maxLength || null,
            requestedFields: requestedFields || null,
            where: where || null,
          });

          return successResponse(docs);
        } catch (error) {
          return errorResponse(
            `Error fetching ${config.plural}: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      }

      if (name === `get_${config.singular}`) {
        try {
          const id = args?.id as string | undefined;
          const _id = args?._id as string | undefined;
          const docName = args?.name as string | undefined;
          const requestedFields = args?.requested_fields as string[] | undefined;

          if (!id && !_id && !docName) {
            return errorResponse("Error: Must provide at least one of: id, _id, or name");
          }

          const doc = await foundryClient.getDocument(
            config.collection,
            { id, _id, name: docName },
            { requestedFields: requestedFields || null }
          );

          if (!doc) {
            return {
              content: [
                {
                  type: "text",
                  text: `${config.description.charAt(0).toUpperCase() + config.description.slice(1)} not found`,
                },
              ],
            };
          }

          return successResponse(doc);
        } catch (error) {
          return errorResponse(
            `Error fetching ${config.description}: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      }
    }

    if (name === "get_world") {
      try {
        const excludeCollections = [...DOCUMENT_TYPES.map((config) => config.collection), ...[ 'packs', 'model', 'template', 'system' ]];
        const world = await foundryClient.getWorld(excludeCollections);
        return successResponse(world);
      } catch (error) {
        return errorResponse(
          `Error fetching world: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    if (name === "modify_document") {
      try {
        const type = args?.type as string | undefined;
        const _id = args?._id as string | undefined;
        const updates = args?.updates as Record<string, unknown>[] | undefined;
        const parentUuid = args?.parent_uuid as string | undefined;
        const pack = args?.pack as string | undefined;

        if (!type) {
          return errorResponse("Error: 'type' is required");
        }
        if (!_id) {
          return errorResponse("Error: '_id' is required");
        }
        if (!updates || !Array.isArray(updates)) {
          return errorResponse("Error: 'updates' must be an array of objects");
        }

        const result = await foundryClient.modifyDocument(type, _id, updates, { parentUuid, pack });
        return successResponse(result);
      } catch (error) {
        return errorResponse(
          `Error modifying document: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    if (name === "create_document") {
      try {
        const type = args?.type as string | undefined;
        const data = args?.data as Record<string, unknown>[] | undefined;
        const parentUuid = args?.parent_uuid as string | undefined;
        const pack = args?.pack as string | undefined;
        const keepId = args?.keep_id === true;

        if (!type) {
          return errorResponse("Error: 'type' is required");
        }
        if (!data || !Array.isArray(data)) {
          return errorResponse("Error: 'data' must be an array of objects");
        }

        const result = await foundryClient.createDocument(type, data, { parentUuid, pack, keepId });
        return successResponse(result);
      } catch (error) {
        return errorResponse(
          `Error creating document: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    if (name === "get_pack_documents") {
      try {
        const type = args?.type as string | undefined;
        const pack = args?.pack as string | undefined;
        const query = (args?.query as Record<string, unknown> | undefined) ?? null;
        const requestedFields = (args?.requested_fields as string[] | undefined) ?? null;
        const maxLength = (args?.max_length as number | undefined) ?? null;

        if (!type) {
          return errorResponse("Error: 'type' is required");
        }
        if (!pack) {
          return errorResponse("Error: 'pack' is required");
        }

        // Index de BDD pour les listings légers (crucial sur les gros packs,
        // ex. 6849 planètes Astronav) ; repli en sources complètes si les
        // entrées d'index sont inutilisables.
        const useIndex = canUseIndex(requestedFields, query);
        let result = await foundryClient.getPackDocuments(type, pack, {
          query,
          requestedFields,
          maxLength,
          index: useIndex,
        });
        if (useIndex && result.length && result.some((d) => d._id === undefined)) {
          result = await foundryClient.getPackDocuments(type, pack, {
            query,
            requestedFields,
            maxLength,
            index: false,
          });
        }
        return successResponse(result);
      } catch (error) {
        return errorResponse(
          `Error reading pack documents: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    if (name === "delete_document") {
      try {
        const type = args?.type as string | undefined;
        const ids = args?.ids as string[] | undefined;
        const parentUuid = args?.parent_uuid as string | undefined;
        const pack = args?.pack as string | undefined;

        if (!type) {
          return errorResponse("Error: 'type' is required");
        }
        if (!ids || !Array.isArray(ids) || ids.length === 0) {
          return errorResponse("Error: 'ids' must be a non-empty array of strings");
        }

        const result = await foundryClient.deleteDocument(type, ids, { parentUuid, pack });
        return successResponse(result);
      } catch (error) {
        return errorResponse(
          `Error deleting document: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    if (name === "show_credentials") {
      try {
        const credentials = foundryClient.getCredentialsInfo();
        return successResponse(credentials);
      } catch (error) {
        return errorResponse(
          `Error fetching credentials: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    if (name === "choose_foundry_instance") {
      try {
        const itemOrder = args?.item_order as number | undefined;
        const _id = args?._id as string | undefined;

        if (itemOrder === undefined && _id === undefined) {
          return errorResponse("Error: Must provide either item_order or _id");
        }

        await foundryClient.chooseFoundryInstance({ item_order: itemOrder, _id });

        const hostname = foundryClient.getHostname();
        return successResponse({
          success: true,
          message: `Successfully connected to ${hostname}`,
          hostname,
        });
      } catch (error) {
        return errorResponse(
          `Error switching Foundry instance: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    if (name === "upload_file") {
      try {
        const target = args?.target as string | undefined;
        const filename = args?.filename as string | undefined;
        const url = args?.url as string | undefined;
        const imageData = args?.image_data as string | undefined;

        if (!target) {
          return errorResponse("Error: 'target' is required");
        }
        if (!filename) {
          return errorResponse("Error: 'filename' is required");
        }

        const result = await foundryClient.uploadFile({
          target,
          filename,
          url,
          image_data: imageData,
        });
        return successResponse(result);
      } catch (error) {
        return errorResponse(
          `Error uploading file: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    if (name === "browse_files") {
      try {
        const target = args?.target as string | undefined;
        const type = args?.type as string | undefined;
        const extensions = args?.extensions as string[] | undefined;

        if (!target) {
          return errorResponse("Error: 'target' is required");
        }

        const result = await foundryClient.browseFiles({
          target,
          type,
          extensions,
        });
        return successResponse(result);
      } catch (error) {
        return errorResponse(
          `Error browsing files: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    if (name === "create_compendium") {
      try {
        const label = args?.label as string | undefined;
        const type = args?.type as string | undefined;

        if (!label) {
          return errorResponse("Error: 'label' is required");
        }
        if (!type) {
          return errorResponse("Error: 'type' is required");
        }

        const result = await foundryClient.createCompendium(label, type);
        return successResponse(result);
      } catch (error) {
        return errorResponse(
          `Error creating compendium: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    if (name === "delete_compendium") {
      try {
        const name = args?.name as string | undefined;

        if (!name) {
          return errorResponse("Error: 'name' is required");
        }

        const result = await foundryClient.deleteCompendium(name);
        return successResponse(result);
      } catch (error) {
        return errorResponse(
          `Error deleting compendium: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    if (name === "create_directory") {
      try {
        const target = args?.target as string | undefined;
        const source = (args?.source as string | undefined) || "data";

        if (!target) {
          return errorResponse("Error: 'target' is required");
        }

        const result = await foundryClient.createDirectory(target, source);
        return successResponse(result);
      } catch (error) {
        return errorResponse(
          `Error creating directory: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    if (name === "show_journal_to_players") {
      try {
        let uuid = args?.uuid as string | undefined;
        const force = (args?.force as boolean | undefined) ?? false;
        const users = (args?.users as string[] | undefined) ?? [];

        if (!uuid) {
          const _id = args?._id as string | undefined;
          const docName = args?.name as string | undefined;
          if (!_id && !docName) {
            return errorResponse("Error: Must provide one of: uuid, _id, or name");
          }
          const doc = await foundryClient.getDocument(
            "journal",
            { _id, name: docName },
            { requestedFields: ["_id", "name"] }
          );
          if (!doc) {
            return errorResponse("Error: JournalEntry not found");
          }
          uuid = `JournalEntry.${doc._id}`;
        }

        await foundryClient.showJournalEntry(uuid, force, users);
        return successResponse({ shown: uuid, force, users: users.length ? users : "all" });
      } catch (error) {
        return errorResponse(
          `Error showing journal: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    if (name === "share_image") {
      try {
        const image = args?.image as string | undefined;
        if (!image) {
          return errorResponse("Error: 'image' is required");
        }

        foundryClient.shareImage({
          image,
          title: args?.title as string | undefined,
          caption: args?.caption as string | undefined,
          users: (args?.users as string[] | undefined) ?? [],
          showTitle: (args?.show_title as boolean | undefined) ?? true,
        });
        return successResponse({ shared: image });
      } catch (error) {
        return errorResponse(
          `Error sharing image: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    if (name === "toggle_pause") {
      try {
        const paused = args?.paused as boolean | undefined;
        if (paused === undefined) {
          return errorResponse("Error: 'paused' is required");
        }

        foundryClient.setPause(paused);
        return successResponse({ paused });
      } catch (error) {
        return errorResponse(
          `Error toggling pause: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    if (name === "activate_scene" || name === "pull_users_to_scene") {
      try {
        const _id = args?._id as string | undefined;
        const docName = args?.name as string | undefined;
        if (!_id && !docName) {
          return errorResponse("Error: Must provide one of: _id or name");
        }

        const scene = await foundryClient.getDocument(
          "scenes",
          { _id, name: docName },
          { requestedFields: ["_id", "name"] }
        );
        if (!scene) {
          return errorResponse("Error: Scene not found");
        }
        const sceneId = scene._id as string;

        if (name === "activate_scene") {
          await foundryClient.modifyDocument("Scene", sceneId, [{ active: true }]);
        }

        let pulled: string[] = [];
        const wantPull = name === "pull_users_to_scene" || (args?.pull_users as boolean | undefined);
        if (wantPull) {
          pulled = (args?.users as string[] | undefined) ?? [];
          if (!pulled.length) {
            const users = (await foundryClient.getDocuments("users", {
              requestedFields: ["_id"],
            })) as Record<string, unknown>[];
            const selfId = foundryClient.getUserId();
            pulled = users.map((u) => u._id as string).filter((id) => id && id !== selfId);
          }
          foundryClient.pullUsersToScene(sceneId, pulled);
        }

        return successResponse({
          scene: { _id: sceneId, name: scene.name },
          activated: name === "activate_scene",
          pulledUsers: pulled,
        });
      } catch (error) {
        return errorResponse(
          `Error on scene operation: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    if (name === "set_setting") {
      try {
        const key = args?.key as string | undefined;
        const value = args?.value;
        if (!key || value === undefined) {
          return errorResponse("Error: 'key' and 'value' are required");
        }

        const serialized = JSON.stringify(value);
        const existing = (await foundryClient.getSettings({
          where: { key },
        })) as Record<string, unknown>[];

        let result: unknown;
        let action: string;
        if (existing.length > 0) {
          const _id = existing[0]._id as string;
          result = await foundryClient.modifyDocument("Setting", _id, [{ value: serialized }]);
          action = "updated";
        } else {
          result = await foundryClient.createDocument("Setting", [{ key, value: serialized }]);
          action = "created";
        }

        return successResponse({ action, key, value, result });
      } catch (error) {
        return errorResponse(
          `Error setting '${args?.key}': ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    if (name === "search_journals") {
      try {
        const query = args?.query as string | undefined;
        if (!query) {
          return errorResponse("Error: 'query' is required");
        }
        const hits = await foundryClient.searchJournals(query, {
          maxResults: (args?.max_results as number | undefined) || null,
        });
        return successResponse(hits);
      } catch (error) {
        return errorResponse(
          `Error searching journals: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    if (name === "list_compendium_packs") {
      try {
        return successResponse(await foundryClient.listPacks());
      } catch (error) {
        return errorResponse(
          `Error listing packs: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    if (name === "import_from_compendium") {
      try {
        const pack = args?.pack as string | undefined;
        const type = args?.type as string | undefined;
        const _id = args?._id as string | undefined;
        const docName = args?.name as string | undefined;
        if (!pack || !type) {
          return errorResponse("Error: 'pack' and 'type' are required");
        }
        if (!_id && !docName) {
          return errorResponse("Error: Must provide one of: _id or name");
        }

        const docs = await foundryClient.getPackDocuments(type, pack, {
          query: _id ? { _id } : { name: docName },
        });
        if (!docs.length) {
          return errorResponse(`Error: Document not found in pack ${pack}`);
        }
        const doc = { ...docs[0] } as Record<string, unknown>;
        doc.folder = (args?.folder as string | undefined) ?? null;

        const result = await foundryClient.createDocument(type, [doc], {
          keepId: (args?.keep_id as boolean | undefined) ?? false,
        });
        return successResponse({ imported: { _id: doc._id, name: doc.name }, from: pack, result });
      } catch (error) {
        return errorResponse(
          `Error importing from compendium: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    if (name === "list_actor_ownership" || name === "set_actor_ownership") {
      try {
        const LEVELS: Record<string, number> = { none: 0, limited: 1, observer: 2, owner: 3 };
        const LEVEL_NAMES = ["none", "limited", "observer", "owner"];
        const users = (await foundryClient.getDocuments("users", {
          requestedFields: ["_id", "name"],
        })) as Record<string, unknown>[];
        const userName = (id: string) => (users.find((u) => u._id === id)?.name as string) ?? id;

        const describeOwnership = (actor: Record<string, unknown>) => {
          const ownership = (actor.ownership as Record<string, number> | undefined) ?? {};
          const entries = Object.entries(ownership)
            .filter(([k]) => k !== "default")
            .map(([userId, level]) => ({ user: userName(userId), userId, level: LEVEL_NAMES[level] ?? level }));
          return {
            _id: actor._id,
            name: actor.name,
            default: LEVEL_NAMES[ownership.default ?? 0] ?? ownership.default,
            users: entries,
          };
        };

        if (name === "list_actor_ownership") {
          const _id = args?._id as string | undefined;
          const docName = args?.name as string | undefined;
          if (_id || docName) {
            const actor = await foundryClient.getDocument(
              "actors",
              { _id, name: docName },
              { requestedFields: ["_id", "name", "ownership"] }
            );
            if (!actor) return errorResponse("Error: Actor not found");
            return successResponse(describeOwnership(actor));
          }
          const actors = (await foundryClient.getDocuments("actors", {
            requestedFields: ["_id", "name", "ownership"],
          })) as Record<string, unknown>[];
          const interesting = actors
            .map(describeOwnership)
            .filter((a) => (a.users as unknown[]).length > 0 || a.default !== "none");
          return successResponse(interesting);
        }

        // set_actor_ownership
        const _id = args?._id as string | undefined;
        const docName = args?.name as string | undefined;
        if (!_id && !docName) {
          return errorResponse("Error: Must provide one of: _id or name (actor)");
        }
        const actor = await foundryClient.getDocument(
          "actors",
          { _id, name: docName },
          { requestedFields: ["_id", "name", "ownership"] }
        );
        if (!actor) return errorResponse("Error: Actor not found");

        const update: Record<string, unknown> = {};
        const userArg = args?.user as string | undefined;
        const level = args?.level as string | undefined;
        if (userArg && level !== undefined) {
          const user = users.find((u) => u._id === userArg || u.name === userArg);
          if (!user) return errorResponse(`Error: User not found: ${userArg}`);
          if (level === "none") {
            update[`ownership.-=${user._id}`] = null;
          } else {
            update[`ownership.${user._id}`] = LEVELS[level];
          }
        } else if (userArg || level) {
          return errorResponse("Error: 'user' and 'level' go together");
        }
        const defaultLevel = args?.default_level as string | undefined;
        if (defaultLevel !== undefined) {
          update["ownership.default"] = LEVELS[defaultLevel];
        }
        if (!Object.keys(update).length) {
          return errorResponse("Error: Nothing to change (provide user+level and/or default_level)");
        }

        const result = await foundryClient.modifyDocument("Actor", actor._id as string, [update]);
        return successResponse({ actor: { _id: actor._id, name: actor.name }, applied: update, result });
      } catch (error) {
        return errorResponse(
          `Error on ownership operation: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    if (name === "get_current_scene") {
      try {
        const requestedFields = (args?.requested_fields as string[] | undefined) ?? [
          "_id",
          "name",
          "active",
          "navigation",
          "navName",
          "background",
        ];
        const scenes = (await foundryClient.getDocuments("scenes", {
          where: { active: true },
          requestedFields,
        })) as Record<string, unknown>[];
        if (!scenes.length) {
          return successResponse({ active: null, note: "No scene is currently active" });
        }
        return successResponse(scenes[0]);
      } catch (error) {
        return errorResponse(
          `Error fetching current scene: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    if (name === "list_tokens" || name === "move_token" || name === "update_token") {
      try {
        // Résolution de la scène : _id / nom fournis, sinon la scène active.
        const sceneId = args?.scene_id as string | undefined;
        const sceneName = args?.scene_name as string | undefined;
        let scene: Record<string, unknown> | null;
        if (sceneId || sceneName) {
          scene = await foundryClient.getDocument(
            "scenes",
            { _id: sceneId, name: sceneName },
            { requestedFields: ["_id", "name", "tokens"] }
          );
        } else {
          const actives = (await foundryClient.getDocuments("scenes", {
            where: { active: true },
            requestedFields: ["_id", "name", "tokens"],
          })) as Record<string, unknown>[];
          scene = actives[0] ?? null;
        }
        if (!scene) {
          return errorResponse("Error: Scene not found (no active scene and none specified)");
        }
        const tokens = (scene.tokens as Record<string, unknown>[] | undefined) ?? [];

        if (name === "list_tokens") {
          return successResponse({
            scene: { _id: scene._id, name: scene.name },
            tokens: tokens.map((t) => ({
              _id: t._id,
              name: t.name,
              x: t.x,
              y: t.y,
              elevation: t.elevation,
              hidden: t.hidden,
              actorId: t.actorId,
              actorLink: t.actorLink,
              disposition: t.disposition,
            })),
          });
        }

        const tokenArg = args?.token as string | undefined;
        if (!tokenArg) {
          return errorResponse("Error: 'token' is required");
        }
        const token = tokens.find((t) => t._id === tokenArg || t.name === tokenArg);
        if (!token) {
          return errorResponse(`Error: Token not found on scene ${scene.name}: ${tokenArg}`);
        }

        let updates: Record<string, unknown>;
        if (name === "move_token") {
          updates = {};
          if (args?.x !== undefined) updates.x = args.x;
          if (args?.y !== undefined) updates.y = args.y;
          if (args?.elevation !== undefined) updates.elevation = args.elevation;
          if (!Object.keys(updates).length) {
            return errorResponse("Error: Provide at least one of: x, y, elevation");
          }
        } else {
          updates = (args?.updates as Record<string, unknown> | undefined) ?? {};
          if (!Object.keys(updates).length) {
            return errorResponse("Error: 'updates' must not be empty");
          }
        }

        const result = await foundryClient.modifyDocument("Token", token._id as string, [updates], {
          parentUuid: `Scene.${scene._id}`,
        });
        return successResponse({
          scene: { _id: scene._id, name: scene.name },
          token: { _id: token._id, name: token.name },
          applied: updates,
          result,
        });
      } catch (error) {
        return errorResponse(
          `Error on token operation: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    if (name === "toggle_actor_condition") {
      try {
        const _id = args?._id as string | undefined;
        const docName = args?.name as string | undefined;
        const condition = args?.condition as string | undefined;
        const active = args?.active as boolean | undefined;
        if (!_id && !docName) {
          return errorResponse("Error: Must provide one of: _id or name (actor)");
        }
        if (!condition || active === undefined) {
          return errorResponse("Error: 'condition' and 'active' are required");
        }
        const status = CORE_STATUS_EFFECTS[condition];
        if (!status) {
          return errorResponse(
            `Error: Unknown condition '${condition}'. Available: ${Object.keys(CORE_STATUS_EFFECTS).join(", ")}`
          );
        }

        const actor = await foundryClient.getDocument(
          "actors",
          { _id, name: docName },
          { requestedFields: ["_id", "name", "effects"] }
        );
        if (!actor) return errorResponse("Error: Actor not found");
        const effects = (actor.effects as Record<string, unknown>[] | undefined) ?? [];
        const existing = effects.filter((e) => Array.isArray(e.statuses) && (e.statuses as string[]).includes(condition));

        if (active) {
          if (existing.length) {
            return successResponse({ actor: { _id: actor._id, name: actor.name }, condition, unchanged: "already active" });
          }
          const result = await foundryClient.createDocument(
            "ActiveEffect",
            [{ name: status.name, img: status.img, statuses: [condition] }],
            { parentUuid: `Actor.${actor._id}` }
          );
          return successResponse({ actor: { _id: actor._id, name: actor.name }, condition, added: true, result });
        }

        if (!existing.length) {
          return successResponse({ actor: { _id: actor._id, name: actor.name }, condition, unchanged: "not active" });
        }
        const result = await foundryClient.deleteDocument(
          "ActiveEffect",
          existing.map((e) => e._id as string),
          { parentUuid: `Actor.${actor._id}` }
        );
        return successResponse({ actor: { _id: actor._id, name: actor.name }, condition, removed: existing.length, result });
      } catch (error) {
        return errorResponse(
          `Error toggling condition: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    if (name === "request_player_roll") {
      try {
        const description = args?.description as string | undefined;
        if (!description) {
          return errorResponse("Error: 'description' is required");
        }
        const pool: Record<string, number> = {};
        for (const die of ["difficulty", "challenge", "ability", "proficiency", "boost", "setback", "force"]) {
          const n = args?.[die] as number | undefined;
          if (n) pool[die] = n;
        }
        const body = (args?.content as string | undefined) ?? `<h3>🎲 ${description}</h3>`;
        const whisper = (args?.whisper_users as string[] | undefined) ?? [];

        // Format vérifié dans le système starwarsffg (bouton .ffg-pool-to-player) :
        // le clic ouvre le dialogue de jet FFG pré-rempli avec dicePool.
        const message: Record<string, unknown> = {
          content: `${body}\n<button class="ffg-pool-to-player">🎲 Lancer — ${description}</button>`,
          author: foundryClient.getUserId(),
          flags: {
            starwarsffg: {
              dicePool: pool,
              description,
              roll: {
                data: {},
                skillName: (args?.skill_name as string | undefined) ?? description,
                item: {},
                flavor: "",
                sound: null,
              },
            },
          },
        };
        if (whisper.length) message.whisper = whisper;

        const result = await foundryClient.createDocument("ChatMessage", [message]);
        return successResponse({ posted: description, pool, whisper: whisper.length ? whisper : "public", result });
      } catch (error) {
        return errorResponse(
          `Error posting roll request: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    if (name === "control_playlist") {
      try {
        const playlistArg = args?.playlist as string | undefined;
        const action = args?.action as string | undefined;
        if (!playlistArg || !action) {
          return errorResponse("Error: 'playlist' and 'action' are required");
        }
        const playlist = await foundryClient.getDocument(
          "playlists",
          { _id: playlistArg, name: playlistArg },
          {}
        ) ?? await foundryClient.getDocument("playlists", { name: playlistArg }, {});
        if (!playlist) return errorResponse(`Error: Playlist not found: ${playlistArg}`);
        const sounds = ((playlist.sounds as Record<string, unknown>[] | undefined) ?? [])
          .slice()
          .sort((a, b) => ((a.sort as number) ?? 0) - ((b.sort as number) ?? 0));
        const mode = (playlist.mode as number) ?? 0; // -1 soundboard, 0 séquentiel, 1 aléatoire, 2 simultané

        let update: Record<string, unknown>;
        if (action === "stop") {
          // Playlist#stopAll : playing:false partout.
          update = { playing: false, sounds: sounds.map((s) => ({ _id: s._id, playing: false })) };
        } else {
          const soundArg = args?.sound as string | undefined;
          let playingIds: string[];
          if (soundArg) {
            const sound = sounds.find((s) => s._id === soundArg || s.name === soundArg);
            if (!sound) return errorResponse(`Error: Sound not found in playlist: ${soundArg}`);
            playingIds = [sound._id as string];
          } else if (mode === 2) {
            playingIds = sounds.map((s) => s._id as string); // simultané : tout
          } else if (mode === -1) {
            return errorResponse("Error: soundboard playlist — provide 'sound'");
          } else {
            if (!sounds.length) return errorResponse("Error: playlist has no sounds");
            playingIds = [sounds[0]._id as string]; // séquentiel/aléatoire : premier
          }
          update = {
            playing: true,
            sounds: sounds.map((s) => ({ _id: s._id, playing: playingIds.includes(s._id as string) })),
          };
        }

        const result = await foundryClient.modifyDocument("Playlist", playlist._id as string, [update]);
        return successResponse({
          playlist: { _id: playlist._id, name: playlist.name },
          action,
          playing: action === "play"
            ? sounds.filter((s) => (update.sounds as { _id: unknown; playing: boolean }[])
                .find((u) => u._id === s._id)?.playing).map((s) => s.name)
            : [],
          result,
        });
      } catch (error) {
        return errorResponse(
          `Error controlling playlist: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    if (name === "manage_combat") {
      try {
        const action = args?.action as string | undefined;
        if (!action) return errorResponse("Error: 'action' is required");

        const sortedCombatants = (combat: Record<string, unknown>) =>
          ((combat.combatants as Record<string, unknown>[] | undefined) ?? [])
            .slice()
            .sort((a, b) => ((b.initiative as number) ?? -Infinity) - ((a.initiative as number) ?? -Infinity));

        // Les Combatants ne stockent pas de nom : il vient de leur token.
        const withNames = async (combat: Record<string, unknown>, order: Record<string, unknown>[]) => {
          if (!order.length || order.every((c) => c.name)) return order;
          const sceneId = (combat.scene as string) ?? (order[0].sceneId as string);
          if (!sceneId) return order;
          const scene = await foundryClient.getDocument("scenes", { _id: sceneId }, { requestedFields: ["_id", "tokens"] });
          const tokens = ((scene?.tokens as Record<string, unknown>[] | undefined) ?? []);
          return order.map((c) => ({
            ...c,
            name: c.name ?? tokens.find((t) => t._id === c.tokenId)?.name ?? null,
          }));
        };

        const resolveCombat = async (): Promise<Record<string, unknown> | null> => {
          const combatId = args?.combat_id as string | undefined;
          if (combatId) return foundryClient.getDocument("combats", { _id: combatId }, {});
          const combats = (await foundryClient.getDocuments("combats", {})) as Record<string, unknown>[];
          return combats.find((c) => c.active) ?? combats[0] ?? null;
        };

        const resolveSceneTokens = async (sceneId?: string) => {
          const scene = sceneId
            ? await foundryClient.getDocument("scenes", { _id: sceneId }, { requestedFields: ["_id", "name", "tokens"] })
            : ((await foundryClient.getDocuments("scenes", { where: { active: true }, requestedFields: ["_id", "name", "tokens"] })) as Record<string, unknown>[])[0];
          if (!scene) throw new Error("Scene not found (no active scene and none specified)");
          return scene;
        };

        if (action === "create") {
          const scene = await resolveSceneTokens(args?.scene_id as string | undefined);
          const allTokens = (scene.tokens as Record<string, unknown>[] | undefined) ?? [];
          const wanted = args?.tokens as string[] | undefined;
          const tokens = (wanted
            ? allTokens.filter((t) => wanted.includes(t._id as string) || wanted.includes(t.name as string))
            : allTokens.filter((t) => t.actorId));
          const created = await foundryClient.createDocument("Combat", [{ scene: scene._id, active: true }]);
          const combatId = ((created.result as Record<string, unknown>[] | undefined) ?? [])[0]?._id as string | undefined;
          if (!combatId) return errorResponse(`Error: Combat creation gave no _id: ${JSON.stringify(created)}`);
          let combatants: Record<string, unknown> | null = null;
          if (tokens.length) {
            combatants = await foundryClient.createDocument(
              "Combatant",
              tokens.map((t) => ({ tokenId: t._id, sceneId: scene._id, actorId: t.actorId, hidden: t.hidden ?? false })),
              { parentUuid: `Combat.${combatId}` }
            );
          }
          return successResponse({ combat: combatId, scene: { _id: scene._id, name: scene.name }, combatants: tokens.map((t) => t.name), result: combatants });
        }

        const combat = await resolveCombat();
        if (!combat) return errorResponse("Error: No combat found (create one first)");
        const combatId = combat._id as string;

        if (action === "add_combatants") {
          const scene = await resolveSceneTokens((combat.scene as string) ?? undefined);
          const allTokens = (scene.tokens as Record<string, unknown>[] | undefined) ?? [];
          const wanted = args?.tokens as string[] | undefined;
          if (!wanted?.length) return errorResponse("Error: 'tokens' is required");
          const tokens = allTokens.filter((t) => wanted.includes(t._id as string) || wanted.includes(t.name as string));
          if (!tokens.length) return errorResponse("Error: none of the tokens were found on the scene");
          const result = await foundryClient.createDocument(
            "Combatant",
            tokens.map((t) => ({ tokenId: t._id, sceneId: scene._id, actorId: t.actorId, hidden: t.hidden ?? false })),
            { parentUuid: `Combat.${combatId}` }
          );
          return successResponse({ combat: combatId, added: tokens.map((t) => t.name), result });
        }

        if (action === "set_initiative") {
          const who = args?.combatant as string | undefined;
          const initiative = args?.initiative as number | undefined;
          if (!who || initiative === undefined) {
            return errorResponse("Error: 'combatant' and 'initiative' are required");
          }
          const all = (combat.combatants as Record<string, unknown>[] | undefined) ?? [];
          const target = all.find((c) => c._id === who || c.name === who);
          if (!target) return errorResponse(`Error: Combatant not found: ${who}`);
          const result = await foundryClient.modifyDocument("Combatant", target._id as string, [{ initiative }], {
            parentUuid: `Combat.${combatId}`,
          });
          return successResponse({ combat: combatId, combatant: target.name ?? target._id, initiative, result });
        }

        if (action === "start") {
          // Combat#startCombat : {round:1, turn:0}.
          const result = await foundryClient.modifyDocument("Combat", combatId, [{ round: 1, turn: 0 }]);
          return successResponse({ combat: combatId, started: true, result });
        }

        if (action === "next_turn" || action === "next_round") {
          const order = await withNames(combat, sortedCombatants(combat));
          const round = (combat.round as number) ?? 0;
          const turn = (combat.turn as number) ?? 0;
          let update: Record<string, unknown>;
          if (action === "next_round" || turn + 1 >= order.length) {
            update = { round: round + 1, turn: 0 };
          } else {
            update = { turn: turn + 1 };
          }
          const result = await foundryClient.modifyDocument("Combat", combatId, [update]);
          const newTurn = (update.turn as number) ?? 0;
          return successResponse({
            combat: combatId,
            round: (update.round as number) ?? round,
            turn: newTurn,
            current: order[newTurn]?.name ?? null,
            result,
          });
        }

        if (action === "status") {
          const order = await withNames(combat, sortedCombatants(combat));
          return successResponse({
            combat: combatId,
            active: combat.active,
            round: combat.round,
            turn: combat.turn,
            current: order[(combat.turn as number) ?? 0]?.name ?? null,
            order: order.map((c) => ({ _id: c._id, name: c.name, initiative: c.initiative, defeated: c.defeated })),
          });
        }

        if (action === "end") {
          const result = await foundryClient.deleteDocument("Combat", [combatId]);
          return successResponse({ combat: combatId, ended: true, result });
        }

        return errorResponse(`Error: Unknown action '${action}'`);
      } catch (error) {
        return errorResponse(
          `Error managing combat: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    if (name === "place_token") {
      try {
        const actorArg = args?.actor as string | undefined;
        const x = args?.x as number | undefined;
        const y = args?.y as number | undefined;
        if (!actorArg || x === undefined || y === undefined) {
          return errorResponse("Error: 'actor', 'x' and 'y' are required");
        }
        const actor = await foundryClient.getDocument(
          "actors",
          { _id: actorArg, name: actorArg },
          { requestedFields: ["_id", "name", "prototypeToken"] }
        ) ?? await foundryClient.getDocument("actors", { name: actorArg }, { requestedFields: ["_id", "name", "prototypeToken"] });
        if (!actor) return errorResponse(`Error: Actor not found: ${actorArg}`);

        const sceneId = args?.scene_id as string | undefined;
        const sceneName = args?.scene_name as string | undefined;
        const scene = sceneId || sceneName
          ? await foundryClient.getDocument("scenes", { _id: sceneId, name: sceneName }, { requestedFields: ["_id", "name"] })
          : ((await foundryClient.getDocuments("scenes", { where: { active: true }, requestedFields: ["_id", "name"] })) as Record<string, unknown>[])[0];
        if (!scene) return errorResponse("Error: Scene not found (no active scene and none specified)");

        const proto = (actor.prototypeToken as Record<string, unknown> | undefined) ?? {};
        const tokenData: Record<string, unknown> = {
          ...proto,
          name: (proto.name as string) || actor.name,
          actorId: actor._id,
          x,
          y,
        };
        if (args?.hidden !== undefined) tokenData.hidden = args.hidden;

        const result = await foundryClient.createDocument("Token", [tokenData], {
          parentUuid: `Scene.${scene._id}`,
        });
        return successResponse({
          actor: { _id: actor._id, name: actor.name },
          scene: { _id: scene._id, name: scene.name },
          x, y,
          result,
        });
      } catch (error) {
        return errorResponse(
          `Error placing token: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    if (name === "roll_ffg_pool") {
      try {
        const description = args?.description as string | undefined;
        if (!description) return errorResponse("Error: 'description' is required");
        const pool: FfgPool = {};
        for (const die of ["ability", "proficiency", "difficulty", "challenge", "boost", "setback", "force"] as const) {
          const n = args?.[die] as number | undefined;
          if (n) pool[die] = n;
        }
        const roll = rollFfgPool(pool);
        const summary = formatResult(roll);

        let posted = false;
        if ((args?.post as boolean | undefined) ?? true) {
          const whisper = (args?.whisper_users as string[] | undefined) ?? [];
          const facesHtml = Object.entries(roll.faces)
            .map(([die, faces]) => `<em>${die}</em> : ${faces.join(", ")}`)
            .join("<br>");
          const message: Record<string, unknown> = {
            content: `<h3>🎲 ${description}</h3><p>${formatPool(pool)}</p><p><strong>${summary}</strong></p><p style="font-size:.85em">${facesHtml}</p>`,
            author: foundryClient.getUserId(),
            flags: { "foundry-mcp": { roll: { pool, result: roll } } },
          };
          if (whisper.length) message.whisper = whisper;
          await foundryClient.createDocument("ChatMessage", [message]);
          posted = true;
        }
        return successResponse({ description, pool: formatPool(pool), summary, detail: roll, posted });
      } catch (error) {
        return errorResponse(
          `Error rolling FFG pool: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    if (name === "cc_list_sheets" || name === "cc_get_sheet") {
      try {
        if (name === "cc_get_sheet") {
          const _id = args?._id as string | undefined;
          const docName = args?.name as string | undefined;
          if (!_id && !docName) return errorResponse("Error: Must provide one of: _id or name");
          const sheet = await foundryClient.getDocument("journal", { _id, name: docName }, {});
          const cc = (sheet?.flags as Record<string, unknown> | undefined)?.["campaign-codex"] as Record<string, unknown> | undefined;
          if (!sheet || !cc) return errorResponse("Error: No Campaign Codex sheet found with that identifier");
          return successResponse({
            _id: sheet._id,
            name: sheet.name,
            type: cc.type,
            image: cc.image ?? null,
            data: cc.data ?? {},
            ownership: sheet.ownership,
          });
        }

        const where: Record<string, unknown> = { "flags.campaign-codex__exists": true };
        if (args?.type) where["flags.campaign-codex.type"] = args.type;
        if (args?.name_contains) where["name__contains"] = args.name_contains;
        if (args?.tag) where["flags.campaign-codex.data.tags__contains"] = args.tag;
        const sheets = (await foundryClient.getDocuments("journal", { where })) as Record<string, unknown>[];
        const index = sheets.map((s) => {
          const cc = (s.flags as Record<string, unknown>)["campaign-codex"] as Record<string, unknown>;
          const data = (cc.data as Record<string, unknown> | undefined) ?? {};
          const count = (k: string) => (Array.isArray(data[k]) ? (data[k] as unknown[]).length : 0);
          return {
            _id: s._id,
            name: s.name,
            type: cc.type,
            tags: data.tags ?? undefined,
            linkedActor: data.linkedActor ?? undefined,
            links: count("associates") + count("linkedLocations") + count("linkedShops") + count("linkedNPCs"),
          };
        });
        return successResponse(index);
      } catch (error) {
        return errorResponse(
          `Error on Campaign Codex read: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    if (name === "cc_create_sheet") {
      try {
        const sheetName = args?.name as string | undefined;
        const type = args?.type as string | undefined;
        if (!sheetName || !type) return errorResponse("Error: 'name' and 'type' are required");
        if (!CC_DATA_DEFAULTS[type]) {
          return errorResponse(`Error: Unknown Campaign Codex type '${type}'. Valid: ${CC_TYPES.join(", ")}`);
        }
        const description = (args?.description as string | undefined) ?? "";
        const data: Record<string, unknown> = { ...CC_DATA_DEFAULTS[type], description };
        if (args?.tags && "tags" in data) data.tags = args.tags;
        if (args?.linked_actor && "linkedActor" in data) {
          const actorArg = args.linked_actor as string;
          const actor = await foundryClient.getDocument("actors", { _id: actorArg, name: actorArg }, { requestedFields: ["_id", "name"] })
            ?? await foundryClient.getDocument("actors", { name: actorArg }, { requestedFields: ["_id", "name"] });
          if (!actor) return errorResponse(`Error: linked_actor not found: ${actorArg}`);
          data.linkedActor = `Actor.${actor._id}`;
        }

        const flagsCc: Record<string, unknown> = { type, data };
        if (args?.image) flagsCc.image = args.image;
        const doc: Record<string, unknown> = {
          name: sheetName,
          flags: { "campaign-codex": flagsCc },
          pages: [{ name: sheetName, type: "text", text: { content: description } }],
          ownership: { default: (args?.gm_only as boolean | undefined) ? 0 : 2 },
        };
        const result = await foundryClient.createDocument("JournalEntry", [doc]);
        const created = ((result.result as Record<string, unknown>[] | undefined) ?? [])[0];
        return successResponse({ created: { _id: created?._id, name: sheetName, type }, result });
      } catch (error) {
        return errorResponse(
          `Error creating Campaign Codex sheet: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    if (name === "cc_link") {
      try {
        const fromArg = args?.from as string | undefined;
        const toArg = args?.to as string | undefined;
        const relation = (args?.relation as string | undefined) ?? "associates";
        if (!fromArg || !toArg) return errorResponse("Error: 'from' and 'to' are required");

        const getSheet = async (idOrName: string) => {
          const s = await foundryClient.getDocument("journal", { _id: idOrName, name: idOrName }, {})
            ?? await foundryClient.getDocument("journal", { name: idOrName }, {});
          const cc = (s?.flags as Record<string, unknown> | undefined)?.["campaign-codex"] as Record<string, unknown> | undefined;
          return s && cc ? { sheet: s, cc } : null;
        };
        const from = await getSheet(fromArg);
        if (!from) return errorResponse(`Error: Source sheet not found: ${fromArg}`);
        const fromData = (from.cc.data as Record<string, unknown> | undefined) ?? {};

        let targetRef: string;
        let targetLabel: string;
        if (relation === "linkedActor") {
          const actor = await foundryClient.getDocument("actors", { _id: toArg, name: toArg }, { requestedFields: ["_id", "name"] })
            ?? await foundryClient.getDocument("actors", { name: toArg }, { requestedFields: ["_id", "name"] });
          if (!actor) return errorResponse(`Error: Actor not found: ${toArg}`);
          targetRef = `Actor.${actor._id}`;
          targetLabel = actor.name as string;
        } else {
          const to = await getSheet(toArg);
          if (!to) return errorResponse(`Error: Target sheet not found: ${toArg}`);
          targetRef = `JournalEntry.${to.sheet._id}`;
          targetLabel = to.sheet.name as string;

          if (args?.bidirectional) {
            const toData = (to.cc.data as Record<string, unknown> | undefined) ?? {};
            const reverse = Array.isArray(toData.associates) ? (toData.associates as string[]) : [];
            const fromRef = `JournalEntry.${from.sheet._id}`;
            if (!reverse.includes(fromRef)) {
              await foundryClient.modifyDocument("JournalEntry", to.sheet._id as string, [
                { flags: { "campaign-codex": { data: { associates: [...reverse, fromRef] } } } },
              ]);
            }
          }
        }

        let update: Record<string, unknown>;
        if (relation === "linkedActor" || relation === "linkedLocation") {
          update = { [relation]: targetRef };
        } else {
          const list = Array.isArray(fromData[relation]) ? (fromData[relation] as string[]) : [];
          if (list.includes(targetRef)) {
            return successResponse({ from: from.sheet.name, to: targetLabel, relation, unchanged: "already linked" });
          }
          update = { [relation]: [...list, targetRef] };
        }
        const result = await foundryClient.modifyDocument("JournalEntry", from.sheet._id as string, [
          { flags: { "campaign-codex": { data: update } } },
        ]);
        return successResponse({ from: from.sheet.name, to: targetLabel, relation, bidirectional: !!args?.bidirectional, result });
      } catch (error) {
        return errorResponse(
          `Error linking Campaign Codex sheets: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    if (name === "get_events") {
      try {
        const { lastSeq, events } = foundryClient.getEvents(
          (args?.since_seq as number | undefined) ?? 0,
          { event: args?.event as string | undefined, limit: args?.limit as number | undefined }
        );
        return successResponse({ lastSeq, count: events.length, events });
      } catch (error) {
        return errorResponse(
          `Error reading events: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    if (name === "wait_for_message") {
      try {
        const where = (args?.where as Record<string, unknown> | undefined) ?? null;
        const timeoutS = Math.min((args?.timeout_seconds as number | undefined) ?? 60, 120);
        const sinceSeq = (args?.since_seq as number | undefined) ?? foundryClient.getEventSeq();

        const match = await foundryClient.waitForEvent(
          (e) => {
            if (e.event !== "modifyDocument") return undefined;
            const payload = e.args.find(
              (a): a is Record<string, unknown> =>
                typeof a === "object" && a !== null && (a as Record<string, unknown>).type === "ChatMessage"
            );
            if (!payload || payload.action !== "create") return undefined;
            const docs = (payload.result as Record<string, unknown>[] | undefined) ?? [];
            const hits = filterDocumentsByWhere(docs, where);
            return hits.length ? hits : undefined;
          },
          timeoutS * 1000,
          sinceSeq
        );

        if (match === undefined) {
          return successResponse({ timeout: true, waited_seconds: timeoutS, messages: [] });
        }
        return successResponse({ timeout: false, messages: match });
      } catch (error) {
        return errorResponse(
          `Error waiting for message: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    throw new Error(`Unknown tool: ${name}`);
  };
}
