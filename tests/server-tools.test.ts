import {
  createToolDefinitions,
  createToolHandler,
  DOCUMENT_TYPES,
} from "../src/server-tools.js";

describe("server tools", () => {
  test("createToolDefinitions includes document tools", () => {
    const tools = createToolDefinitions();
    const actorList = tools.find((tool) => tool.name === "get_actors");
    const actorGet = tools.find((tool) => tool.name === "get_actor");
    expect(actorList).toBeTruthy();
    expect(actorGet).toBeTruthy();
  });

  test("createToolDefinitions includes compendium tools", () => {
    const tools = createToolDefinitions();
    const createCompendium = tools.find((tool) => tool.name === "create_compendium");
    const deleteCompendium = tools.find((tool) => tool.name === "delete_compendium");
    expect(createCompendium).toBeTruthy();
    expect(deleteCompendium).toBeTruthy();
    expect(createCompendium?.inputSchema.required).toContain("label");
    expect(createCompendium?.inputSchema.required).toContain("type");
    expect(deleteCompendium?.inputSchema.required).toContain("name");
  });

  test("document tools include pack parameter", () => {
    const tools = createToolDefinitions();
    const modifyDocument = tools.find((tool) => tool.name === "modify_document");
    const createDocument = tools.find((tool) => tool.name === "create_document");
    const deleteDocument = tools.find((tool) => tool.name === "delete_document");

    expect(modifyDocument?.inputSchema.properties).toHaveProperty("pack");
    expect(createDocument?.inputSchema.properties).toHaveProperty("pack");
    expect(deleteDocument?.inputSchema.properties).toHaveProperty("pack");
  });

  test("handler blocks when not connected", async () => {
    const client = {
      isConnected: () => false,
    } as any;
    const handler = createToolHandler(client);

    const response = await handler({ params: { name: "get_actors" } });
    expect((response as any).isError).toBe(true);
  });

  test("get_[plural] returns documents", async () => {
    const client = {
      isConnected: () => true,
      getDocuments: jest.fn().mockResolvedValue([{ _id: "1" }]),
    } as any;

    const handler = createToolHandler(client);
    const response = await handler({
      params: {
        name: "get_actors",
        arguments: { max_length: 5, requested_fields: ["name"], where: { type: "npc" } },
      },
    });

    expect(client.getDocuments).toHaveBeenCalled();
    expect((response as any).isError).toBeUndefined();
  });

  test("get_[plural] returns error on failure", async () => {
    const client = {
      isConnected: () => true,
      getDocuments: jest.fn().mockRejectedValue(new Error("boom")),
    } as any;

    const handler = createToolHandler(client);
    const response = await handler({ params: { name: "get_actors" } });

    expect((response as any).isError).toBe(true);
    expect(response.content[0].text).toContain("boom");
  });

  test("get_[singular] requires identifier", async () => {
    const client = {
      isConnected: () => true,
    } as any;

    const handler = createToolHandler(client);
    const response = await handler({ params: { name: "get_actor", arguments: {} } });

    expect((response as any).isError).toBe(true);
  });

  test("get_[singular] returns not found", async () => {
    const client = {
      isConnected: () => true,
      getDocument: jest.fn().mockResolvedValue(null),
    } as any;

    const handler = createToolHandler(client);
    const response = await handler({ params: { name: "get_actor", arguments: { name: "Missing" } } });

    expect((response as any).isError).toBeUndefined();
    expect(response.content[0].text).toContain("not found");
  });

  test("get_[singular] returns error on failure", async () => {
    const client = {
      isConnected: () => true,
      getDocument: jest.fn().mockRejectedValue(new Error("nope")),
    } as any;

    const handler = createToolHandler(client);
    const response = await handler({ params: { name: "get_actor", arguments: { name: "x" } } });

    expect((response as any).isError).toBe(true);
  });

  test("get_world returns world", async () => {
    const client = {
      isConnected: () => true,
      getWorld: jest.fn().mockResolvedValue({ title: "World" }),
    } as any;

    const handler = createToolHandler(client);
    const response = await handler({ params: { name: "get_world" } });

    expect(client.getWorld).toHaveBeenCalledWith(
      [...DOCUMENT_TYPES.map((config) => config.collection), ...[ 'packs', 'model', 'template', 'system' ]]
    );
    expect((response as any).isError).toBeUndefined();
  });

  test("modify_document validates inputs", async () => {
    const client = {
      isConnected: () => true,
    } as any;

    const handler = createToolHandler(client);
    const response = await handler({ params: { name: "modify_document", arguments: { _id: "1" } } });

    expect((response as any).isError).toBe(true);
  });

  test("modify_document executes", async () => {
    const client = {
      isConnected: () => true,
      modifyDocument: jest.fn().mockResolvedValue({ ok: true }),
    } as any;

    const handler = createToolHandler(client);
    const response = await handler({
      params: {
        name: "modify_document",
        arguments: { type: "Actor", _id: "1", updates: [{ name: "x" }], parent_uuid: "Scene.1" },
      },
    });

    expect(client.modifyDocument).toHaveBeenCalledWith("Actor", "1", [{ name: "x" }], { parentUuid: "Scene.1", pack: undefined });
    expect((response as any).isError).toBeUndefined();
  });

  test("modify_document executes with pack", async () => {
    const client = {
      isConnected: () => true,
      modifyDocument: jest.fn().mockResolvedValue({ ok: true }),
    } as any;

    const handler = createToolHandler(client);
    const response = await handler({
      params: {
        name: "modify_document",
        arguments: {
          type: "Actor",
          _id: "1",
          updates: [{ name: "x" }],
          pack: "world.my-compendium",
        },
      },
    });

    expect(client.modifyDocument).toHaveBeenCalledWith("Actor", "1", [{ name: "x" }], {
      parentUuid: undefined,
      pack: "world.my-compendium",
    });
    expect((response as any).isError).toBeUndefined();
  });

  test("modify_document returns error on failure", async () => {
    const client = {
      isConnected: () => true,
      modifyDocument: jest.fn().mockRejectedValue(new Error("Modify failed")),
    } as any;

    const handler = createToolHandler(client);
    const response = await handler({
      params: {
        name: "modify_document",
        arguments: { type: "Actor", _id: "1", updates: [{ name: "x" }] },
      },
    });

    expect((response as any).isError).toBe(true);
    expect(response.content[0].text).toContain("Modify failed");
  });

  test("create_document validates inputs", async () => {
    const client = {
      isConnected: () => true,
    } as any;

    const handler = createToolHandler(client);
    const response = await handler({ params: { name: "create_document", arguments: { type: "Actor" } } });

    expect((response as any).isError).toBe(true);
  });

  test("create_document executes", async () => {
    const client = {
      isConnected: () => true,
      createDocument: jest.fn().mockResolvedValue({ ok: true }),
    } as any;

    const handler = createToolHandler(client);
    const response = await handler({
      params: {
        name: "create_document",
        arguments: { type: "Actor", data: [{ name: "x" }], parent_uuid: "Scene.1" },
      },
    });

    expect(client.createDocument).toHaveBeenCalledWith("Actor", [{ name: "x" }], {
      parentUuid: "Scene.1",
      pack: undefined,
      keepId: false,
    });
    expect((response as any).isError).toBeUndefined();
  });

  test("create_document executes with pack", async () => {
    const client = {
      isConnected: () => true,
      createDocument: jest.fn().mockResolvedValue({ ok: true }),
    } as any;

    const handler = createToolHandler(client);
    const response = await handler({
      params: {
        name: "create_document",
        arguments: {
          type: "Actor",
          data: [{ name: "Goblin" }],
          pack: "world.monsters",
        },
      },
    });

    expect(client.createDocument).toHaveBeenCalledWith("Actor", [{ name: "Goblin" }], {
      parentUuid: undefined,
      pack: "world.monsters",
      keepId: false,
    });
    expect((response as any).isError).toBeUndefined();
  });

  test("create_document returns error on failure", async () => {
    const client = {
      isConnected: () => true,
      createDocument: jest.fn().mockRejectedValue(new Error("Create failed")),
    } as any;

    const handler = createToolHandler(client);
    const response = await handler({
      params: {
        name: "create_document",
        arguments: { type: "Actor", data: [{ name: "x" }] },
      },
    });

    expect((response as any).isError).toBe(true);
    expect(response.content[0].text).toContain("Create failed");
  });

  test("delete_document validates inputs", async () => {
    const client = {
      isConnected: () => true,
    } as any;

    const handler = createToolHandler(client);
    const response = await handler({ params: { name: "delete_document", arguments: { type: "Actor", ids: [] } } });

    expect((response as any).isError).toBe(true);
  });

  test("delete_document executes", async () => {
    const client = {
      isConnected: () => true,
      deleteDocument: jest.fn().mockResolvedValue({ ok: true }),
    } as any;

    const handler = createToolHandler(client);
    const response = await handler({
      params: {
        name: "delete_document",
        arguments: { type: "Actor", ids: ["1", "2"], parent_uuid: "Scene.1" },
      },
    });

    expect(client.deleteDocument).toHaveBeenCalledWith("Actor", ["1", "2"], {
      parentUuid: "Scene.1",
      pack: undefined,
    });
    expect((response as any).isError).toBeUndefined();
  });

  test("delete_document executes with pack", async () => {
    const client = {
      isConnected: () => true,
      deleteDocument: jest.fn().mockResolvedValue({ ok: true }),
    } as any;

    const handler = createToolHandler(client);
    const response = await handler({
      params: {
        name: "delete_document",
        arguments: {
          type: "Actor",
          ids: ["abc123"],
          pack: "world.monsters",
        },
      },
    });

    expect(client.deleteDocument).toHaveBeenCalledWith("Actor", ["abc123"], {
      parentUuid: undefined,
      pack: "world.monsters",
    });
    expect((response as any).isError).toBeUndefined();
  });

  test("delete_document returns error on failure", async () => {
    const client = {
      isConnected: () => true,
      deleteDocument: jest.fn().mockRejectedValue(new Error("Delete failed")),
    } as any;

    const handler = createToolHandler(client);
    const response = await handler({
      params: {
        name: "delete_document",
        arguments: { type: "Actor", ids: ["1"] },
      },
    });

    expect((response as any).isError).toBe(true);
    expect(response.content[0].text).toContain("Delete failed");
  });

  test("show_credentials returns data", async () => {
    const client = {
      isConnected: () => true,
      getCredentialsInfo: jest.fn().mockReturnValue([{ _id: "x" }]),
    } as any;

    const handler = createToolHandler(client);
    const response = await handler({ params: { name: "show_credentials" } });

    expect((response as any).isError).toBeUndefined();
  });

  test("choose_foundry_instance validates inputs", async () => {
    const client = {
      isConnected: () => true,
    } as any;

    const handler = createToolHandler(client);
    const response = await handler({ params: { name: "choose_foundry_instance", arguments: {} } });

    expect((response as any).isError).toBe(true);
  });

  test("choose_foundry_instance returns success", async () => {
    const client = {
      isConnected: () => true,
      chooseFoundryInstance: jest.fn().mockResolvedValue(undefined),
      getHostname: jest.fn().mockReturnValue("host"),
    } as any;

    const handler = createToolHandler(client);
    const response = await handler({ params: { name: "choose_foundry_instance", arguments: { item_order: 0 } } });

    expect((response as any).isError).toBeUndefined();
  });

  test("unknown tool throws", async () => {
    const client = {
      isConnected: () => true,
    } as any;

    const handler = createToolHandler(client);
    await expect(handler({ params: { name: "missing_tool" } }))
      .rejects.toThrow("Unknown tool");
  });

  describe("upload_file", () => {
    test("requires target", async () => {
      const client = {
        isConnected: () => true,
      } as any;

      const handler = createToolHandler(client);
      const response = await handler({
        params: {
          name: "upload_file",
          arguments: { filename: "test.png", image_data: "abc" },
        },
      });

      expect((response as any).isError).toBe(true);
      expect(response.content[0].text).toContain("'target' is required");
    });

    test("requires filename", async () => {
      const client = {
        isConnected: () => true,
      } as any;

      const handler = createToolHandler(client);
      const response = await handler({
        params: {
          name: "upload_file",
          arguments: { target: "worlds/test", image_data: "abc" },
        },
      });

      expect((response as any).isError).toBe(true);
      expect(response.content[0].text).toContain("'filename' is required");
    });

    test("executes successfully with image_data", async () => {
      const client = {
        isConnected: () => true,
        uploadFile: jest.fn().mockResolvedValue({ path: "worlds/test/image.png" }),
      } as any;

      const handler = createToolHandler(client);
      const response = await handler({
        params: {
          name: "upload_file",
          arguments: {
            target: "worlds/test",
            filename: "image.png",
            image_data: "aGVsbG8=",
          },
        },
      });

      expect(client.uploadFile).toHaveBeenCalledWith({
        target: "worlds/test",
        filename: "image.png",
        url: undefined,
        image_data: "aGVsbG8=",
      });
      expect((response as any).isError).toBeUndefined();
    });

    test("executes successfully with url", async () => {
      const client = {
        isConnected: () => true,
        uploadFile: jest.fn().mockResolvedValue({ path: "worlds/test/image.png" }),
      } as any;

      const handler = createToolHandler(client);
      const response = await handler({
        params: {
          name: "upload_file",
          arguments: {
            target: "worlds/test",
            filename: "image.png",
            url: "https://example.com/image.png",
          },
        },
      });

      expect(client.uploadFile).toHaveBeenCalledWith({
        target: "worlds/test",
        filename: "image.png",
        url: "https://example.com/image.png",
        image_data: undefined,
      });
      expect((response as any).isError).toBeUndefined();
    });

    test("returns error on failure", async () => {
      const client = {
        isConnected: () => true,
        uploadFile: jest.fn().mockRejectedValue(new Error("Upload failed")),
      } as any;

      const handler = createToolHandler(client);
      const response = await handler({
        params: {
          name: "upload_file",
          arguments: {
            target: "worlds/test",
            filename: "image.png",
            image_data: "abc",
          },
        },
      });

      expect((response as any).isError).toBe(true);
      expect(response.content[0].text).toContain("Upload failed");
    });
  });

  describe("browse_files", () => {
    test("requires target", async () => {
      const client = {
        isConnected: () => true,
      } as any;

      const handler = createToolHandler(client);
      const response = await handler({
        params: {
          name: "browse_files",
          arguments: {},
        },
      });

      expect((response as any).isError).toBe(true);
      expect(response.content[0].text).toContain("'target' is required");
    });

    test("executes successfully with default options", async () => {
      const client = {
        isConnected: () => true,
        browseFiles: jest.fn().mockResolvedValue({
          target: "worlds/test",
          dirs: ["worlds/test/avatars"],
          files: [],
        }),
      } as any;

      const handler = createToolHandler(client);
      const response = await handler({
        params: {
          name: "browse_files",
          arguments: { target: "worlds/test" },
        },
      });

      expect(client.browseFiles).toHaveBeenCalledWith({
        target: "worlds/test",
        type: undefined,
        extensions: undefined,
      });
      expect((response as any).isError).toBeUndefined();
    });

    test("executes successfully with custom options", async () => {
      const client = {
        isConnected: () => true,
        browseFiles: jest.fn().mockResolvedValue({
          target: "worlds/test",
          dirs: [],
          files: ["worlds/test/song.mp3"],
        }),
      } as any;

      const handler = createToolHandler(client);
      const response = await handler({
        params: {
          name: "browse_files",
          arguments: {
            target: "worlds/test",
            type: "audio",
            extensions: [".mp3", ".wav"],
          },
        },
      });

      expect(client.browseFiles).toHaveBeenCalledWith({
        target: "worlds/test",
        type: "audio",
        extensions: [".mp3", ".wav"],
      });
      expect((response as any).isError).toBeUndefined();
    });

    test("returns error on failure", async () => {
      const client = {
        isConnected: () => true,
        browseFiles: jest.fn().mockRejectedValue(new Error("Directory not found")),
      } as any;

      const handler = createToolHandler(client);
      const response = await handler({
        params: {
          name: "browse_files",
          arguments: { target: "worlds/test" },
        },
      });

      expect((response as any).isError).toBe(true);
      expect(response.content[0].text).toContain("Directory not found");
    });
  });

  describe("create_compendium", () => {
    test("requires label", async () => {
      const client = {
        isConnected: () => true,
      } as any;

      const handler = createToolHandler(client);
      const response = await handler({
        params: {
          name: "create_compendium",
          arguments: { type: "Actor" },
        },
      });

      expect((response as any).isError).toBe(true);
      expect(response.content[0].text).toContain("'label' is required");
    });

    test("requires type", async () => {
      const client = {
        isConnected: () => true,
      } as any;

      const handler = createToolHandler(client);
      const response = await handler({
        params: {
          name: "create_compendium",
          arguments: { label: "My Compendium" },
        },
      });

      expect((response as any).isError).toBe(true);
      expect(response.content[0].text).toContain("'type' is required");
    });

    test("executes successfully", async () => {
      const client = {
        isConnected: () => true,
        createCompendium: jest.fn().mockResolvedValue({
          request: { action: "create" },
          result: {
            label: "My NPCs",
            type: "Actor",
            name: "my-npcs",
            id: "world.my-npcs",
          },
        }),
      } as any;

      const handler = createToolHandler(client);
      const response = await handler({
        params: {
          name: "create_compendium",
          arguments: { label: "My NPCs", type: "Actor" },
        },
      });

      expect(client.createCompendium).toHaveBeenCalledWith("My NPCs", "Actor");
      expect((response as any).isError).toBeUndefined();
      const result = JSON.parse(response.content[0].text);
      expect(result.result.name).toBe("my-npcs");
    });

    test("returns error on failure", async () => {
      const client = {
        isConnected: () => true,
        createCompendium: jest.fn().mockRejectedValue(new Error("Permission denied")),
      } as any;

      const handler = createToolHandler(client);
      const response = await handler({
        params: {
          name: "create_compendium",
          arguments: { label: "My NPCs", type: "Actor" },
        },
      });

      expect((response as any).isError).toBe(true);
      expect(response.content[0].text).toContain("Permission denied");
    });
  });

  describe("delete_compendium", () => {
    test("requires name", async () => {
      const client = {
        isConnected: () => true,
      } as any;

      const handler = createToolHandler(client);
      const response = await handler({
        params: {
          name: "delete_compendium",
          arguments: {},
        },
      });

      expect((response as any).isError).toBe(true);
      expect(response.content[0].text).toContain("'name' is required");
    });

    test("executes successfully", async () => {
      const client = {
        isConnected: () => true,
        deleteCompendium: jest.fn().mockResolvedValue({
          request: { action: "delete", data: "my-npcs" },
          result: "world.my-npcs",
        }),
      } as any;

      const handler = createToolHandler(client);
      const response = await handler({
        params: {
          name: "delete_compendium",
          arguments: { name: "my-npcs" },
        },
      });

      expect(client.deleteCompendium).toHaveBeenCalledWith("my-npcs");
      expect((response as any).isError).toBeUndefined();
      const result = JSON.parse(response.content[0].text);
      expect(result.result).toBe("world.my-npcs");
    });

    test("returns error on failure", async () => {
      const client = {
        isConnected: () => true,
        deleteCompendium: jest.fn().mockRejectedValue(new Error("Compendium not found")),
      } as any;

      const handler = createToolHandler(client);
      const response = await handler({
        params: {
          name: "delete_compendium",
          arguments: { name: "nonexistent" },
        },
      });

      expect((response as any).isError).toBe(true);
      expect(response.content[0].text).toContain("Compendium not found");
    });
  });

  describe("broadcast & file tools", () => {
    test("createToolDefinitions includes the new tools", () => {
      const tools = createToolDefinitions();
      for (const name of [
        "create_directory",
        "show_journal_to_players",
        "share_image",
        "toggle_pause",
        "activate_scene",
        "pull_users_to_scene",
        "set_setting",
      ]) {
        expect(tools.find((tool) => tool.name === name)).toBeDefined();
      }
    });

    test("create_directory executes", async () => {
      const client = {
        isConnected: () => true,
        createDirectory: jest.fn().mockResolvedValue({ path: "worlds/x/img" }),
      } as any;

      const handler = createToolHandler(client);
      const response = await handler({
        params: { name: "create_directory", arguments: { target: "worlds/x/img" } },
      });

      expect(client.createDirectory).toHaveBeenCalledWith("worlds/x/img", "data");
      expect((response as any).isError).toBeUndefined();
    });

    test("create_directory requires target", async () => {
      const client = { isConnected: () => true } as any;
      const handler = createToolHandler(client);
      const response = await handler({ params: { name: "create_directory", arguments: {} } });
      expect((response as any).isError).toBe(true);
    });

    test("show_journal_to_players resolves name to uuid", async () => {
      const client = {
        isConnected: () => true,
        getDocument: jest.fn().mockResolvedValue({ _id: "abc123", name: "Handout" }),
        showJournalEntry: jest.fn().mockResolvedValue(undefined),
      } as any;

      const handler = createToolHandler(client);
      const response = await handler({
        params: { name: "show_journal_to_players", arguments: { name: "Handout", force: true } },
      });

      expect(client.getDocument).toHaveBeenCalledWith(
        "journal",
        { _id: undefined, name: "Handout" },
        { requestedFields: ["_id", "name"] }
      );
      expect(client.showJournalEntry).toHaveBeenCalledWith("JournalEntry.abc123", true, []);
      expect((response as any).isError).toBeUndefined();
    });

    test("show_journal_to_players accepts a raw uuid", async () => {
      const client = {
        isConnected: () => true,
        showJournalEntry: jest.fn().mockResolvedValue(undefined),
      } as any;

      const handler = createToolHandler(client);
      await handler({
        params: {
          name: "show_journal_to_players",
          arguments: { uuid: "JournalEntry.abc123.JournalEntryPage.def456" },
        },
      });

      expect(client.showJournalEntry).toHaveBeenCalledWith(
        "JournalEntry.abc123.JournalEntryPage.def456",
        false,
        []
      );
    });

    test("share_image executes", async () => {
      const client = {
        isConnected: () => true,
        shareImage: jest.fn(),
      } as any;

      const handler = createToolHandler(client);
      const response = await handler({
        params: { name: "share_image", arguments: { image: "worlds/x/a.png", title: "Vision" } },
      });

      expect(client.shareImage).toHaveBeenCalledWith({
        image: "worlds/x/a.png",
        title: "Vision",
        caption: undefined,
        users: [],
        showTitle: true,
      });
      expect((response as any).isError).toBeUndefined();
    });

    test("toggle_pause executes", async () => {
      const client = {
        isConnected: () => true,
        setPause: jest.fn(),
      } as any;

      const handler = createToolHandler(client);
      const response = await handler({
        params: { name: "toggle_pause", arguments: { paused: true } },
      });

      expect(client.setPause).toHaveBeenCalledWith(true);
      expect((response as any).isError).toBeUndefined();
    });

    test("activate_scene updates the scene and can pull users", async () => {
      const client = {
        isConnected: () => true,
        getDocument: jest.fn().mockResolvedValue({ _id: "sc1", name: "Riar" }),
        getDocuments: jest.fn().mockResolvedValue([{ _id: "u1" }, { _id: "bot" }]),
        getUserId: () => "bot",
        modifyDocument: jest.fn().mockResolvedValue({ ok: true }),
        pullUsersToScene: jest.fn(),
      } as any;

      const handler = createToolHandler(client);
      const response = await handler({
        params: { name: "activate_scene", arguments: { name: "Riar", pull_users: true } },
      });

      expect(client.modifyDocument).toHaveBeenCalledWith("Scene", "sc1", [{ active: true }]);
      expect(client.pullUsersToScene).toHaveBeenCalledWith("sc1", ["u1"]);
      expect((response as any).isError).toBeUndefined();
    });

    test("pull_users_to_scene does not activate", async () => {
      const client = {
        isConnected: () => true,
        getDocument: jest.fn().mockResolvedValue({ _id: "sc1", name: "Riar" }),
        getUserId: () => "bot",
        modifyDocument: jest.fn(),
        pullUsersToScene: jest.fn(),
      } as any;

      const handler = createToolHandler(client);
      await handler({
        params: { name: "pull_users_to_scene", arguments: { _id: "sc1", users: ["u1", "u2"] } },
      });

      expect(client.modifyDocument).not.toHaveBeenCalled();
      expect(client.pullUsersToScene).toHaveBeenCalledWith("sc1", ["u1", "u2"]);
    });

    test("set_setting updates an existing setting", async () => {
      const client = {
        isConnected: () => true,
        getSettings: jest.fn().mockResolvedValue([{ _id: "st1", key: "core.x", value: "1" }]),
        modifyDocument: jest.fn().mockResolvedValue({ ok: true }),
      } as any;

      const handler = createToolHandler(client);
      const response = await handler({
        params: { name: "set_setting", arguments: { key: "core.x", value: { a: 1 } } },
      });

      expect(client.modifyDocument).toHaveBeenCalledWith("Setting", "st1", [
        { value: JSON.stringify({ a: 1 }) },
      ]);
      expect((response as any).isError).toBeUndefined();
    });

    test("set_setting creates a missing setting", async () => {
      const client = {
        isConnected: () => true,
        getSettings: jest.fn().mockResolvedValue([]),
        createDocument: jest.fn().mockResolvedValue({ ok: true }),
      } as any;

      const handler = createToolHandler(client);
      await handler({
        params: { name: "set_setting", arguments: { key: "core.y", value: true } },
      });

      expect(client.createDocument).toHaveBeenCalledWith("Setting", [
        { key: "core.y", value: "true" },
      ]);
    });
  });

  describe("lot 1 : recherche, packs, import, ownership, scène courante", () => {
    test("createToolDefinitions includes lot 1 tools", () => {
      const tools = createToolDefinitions();
      for (const name of [
        "search_journals",
        "list_compendium_packs",
        "import_from_compendium",
        "list_actor_ownership",
        "set_actor_ownership",
        "get_current_scene",
      ]) {
        expect(tools.find((tool) => tool.name === name)).toBeDefined();
      }
    });

    test("search_journals delegates to the client", async () => {
      const client = {
        isConnected: () => true,
        searchJournals: jest.fn().mockResolvedValue([{ _id: "j1", match: "content" }]),
      } as any;
      const handler = createToolHandler(client);
      const response = await handler({
        params: { name: "search_journals", arguments: { query: "Jerserra", max_results: 5 } },
      });
      expect(client.searchJournals).toHaveBeenCalledWith("Jerserra", { maxResults: 5 });
      expect((response as any).isError).toBeUndefined();
    });

    test("list_compendium_packs delegates to the client", async () => {
      const client = {
        isConnected: () => true,
        listPacks: jest.fn().mockResolvedValue([{ id: "world.x", label: "X" }]),
      } as any;
      const handler = createToolHandler(client);
      const response = await handler({ params: { name: "list_compendium_packs", arguments: {} } });
      expect(client.listPacks).toHaveBeenCalled();
      expect((response as any).isError).toBeUndefined();
    });

    test("import_from_compendium fetches the pack doc then creates it", async () => {
      const client = {
        isConnected: () => true,
        getPackDocuments: jest.fn().mockResolvedValue([{ _id: "p1", name: "Goblin", folder: "packfolder" }]),
        createDocument: jest.fn().mockResolvedValue({ ok: true }),
      } as any;
      const handler = createToolHandler(client);
      const response = await handler({
        params: {
          name: "import_from_compendium",
          arguments: { pack: "world.monsters", type: "Actor", name: "Goblin", keep_id: true, folder: "f9" },
        },
      });
      expect(client.getPackDocuments).toHaveBeenCalledWith("Actor", "world.monsters", {
        query: { name: "Goblin" },
      });
      expect(client.createDocument).toHaveBeenCalledWith(
        "Actor",
        [{ _id: "p1", name: "Goblin", folder: "f9" }],
        { keepId: true }
      );
      expect((response as any).isError).toBeUndefined();
    });

    test("import_from_compendium errors when doc missing", async () => {
      const client = {
        isConnected: () => true,
        getPackDocuments: jest.fn().mockResolvedValue([]),
      } as any;
      const handler = createToolHandler(client);
      const response = await handler({
        params: { name: "import_from_compendium", arguments: { pack: "world.x", type: "Actor", name: "Nope" } },
      });
      expect((response as any).isError).toBe(true);
    });

    test("list_actor_ownership resolves user names", async () => {
      const client = {
        isConnected: () => true,
        getDocuments: jest.fn().mockResolvedValue([{ _id: "u1", name: "Edeker" }]),
        getDocument: jest.fn().mockResolvedValue({
          _id: "a1",
          name: "Uchebe",
          ownership: { default: 0, u1: 3 },
        }),
      } as any;
      const handler = createToolHandler(client);
      const response = await handler({
        params: { name: "list_actor_ownership", arguments: { name: "Uchebe" } },
      });
      const body = JSON.parse((response as any).content[0].text);
      expect(body).toEqual({
        _id: "a1",
        name: "Uchebe",
        default: "none",
        users: [{ user: "Edeker", userId: "u1", level: "owner" }],
      });
    });

    test("set_actor_ownership grants a level", async () => {
      const client = {
        isConnected: () => true,
        getDocuments: jest.fn().mockResolvedValue([{ _id: "u1", name: "Edeker" }]),
        getDocument: jest.fn().mockResolvedValue({ _id: "a1", name: "Uchebe", ownership: { default: 0 } }),
        modifyDocument: jest.fn().mockResolvedValue({ ok: true }),
      } as any;
      const handler = createToolHandler(client);
      const response = await handler({
        params: {
          name: "set_actor_ownership",
          arguments: { name: "Uchebe", user: "Edeker", level: "owner" },
        },
      });
      expect(client.modifyDocument).toHaveBeenCalledWith("Actor", "a1", [{ "ownership.u1": 3 }]);
      expect((response as any).isError).toBeUndefined();
    });

    test("set_actor_ownership level none removes the key", async () => {
      const client = {
        isConnected: () => true,
        getDocuments: jest.fn().mockResolvedValue([{ _id: "u1", name: "Edeker" }]),
        getDocument: jest.fn().mockResolvedValue({ _id: "a1", name: "Uchebe", ownership: { default: 0, u1: 3 } }),
        modifyDocument: jest.fn().mockResolvedValue({ ok: true }),
      } as any;
      const handler = createToolHandler(client);
      await handler({
        params: {
          name: "set_actor_ownership",
          arguments: { _id: "a1", user: "u1", level: "none" },
        },
      });
      expect(client.modifyDocument).toHaveBeenCalledWith("Actor", "a1", [{ "ownership.-=u1": null }]);
    });

    test("get_current_scene returns the active scene", async () => {
      const client = {
        isConnected: () => true,
        getDocuments: jest.fn().mockResolvedValue([{ _id: "sc1", name: "Toydaria", active: true }]),
      } as any;
      const handler = createToolHandler(client);
      const response = await handler({ params: { name: "get_current_scene", arguments: {} } });
      expect(client.getDocuments).toHaveBeenCalledWith("scenes", expect.objectContaining({
        where: { active: true },
      }));
      const body = JSON.parse((response as any).content[0].text);
      expect(body.name).toBe("Toydaria");
    });

    test("get_current_scene handles no active scene", async () => {
      const client = {
        isConnected: () => true,
        getDocuments: jest.fn().mockResolvedValue([]),
      } as any;
      const handler = createToolHandler(client);
      const response = await handler({ params: { name: "get_current_scene", arguments: {} } });
      const body = JSON.parse((response as any).content[0].text);
      expect(body.active).toBeNull();
    });
  });

  describe("qualité MCP : annotations et pagination", () => {
    test("chaque outil porte des annotations explicites", () => {
      const tools = createToolDefinitions() as any[];
      for (const tool of tools) {
        expect(tool.annotations).toBeDefined();
        expect(typeof tool.annotations.readOnlyHint).toBe("boolean");
        expect(typeof tool.annotations.destructiveHint).toBe("boolean");
      }
    });

    test("les lectures sont readOnly, les deletes destructifs", () => {
      const tools = createToolDefinitions() as any[];
      const byName = Object.fromEntries(tools.map((t) => [t.name, t.annotations]));
      expect(byName.get_actors.readOnlyHint).toBe(true);
      expect(byName.search_journals.readOnlyHint).toBe(true);
      expect(byName.cc_get_sheet.readOnlyHint).toBe(true);
      expect(byName.wait_for_message.readOnlyHint).toBe(true);
      expect(byName.create_document.readOnlyHint).toBe(false);
      expect(byName.delete_document.destructiveHint).toBe(true);
      expect(byName.delete_compendium.destructiveHint).toBe(true);
      expect(byName.modify_document.destructiveHint).toBe(false);
      expect(byName.draw_from_table.destructiveHint).toBe(false);
    });

    test("offset/limit paginent les listes", async () => {
      const docs = Array.from({ length: 10 }, (_, i) => ({ _id: `a${i}`, name: `Actor ${i}` }));
      const client = {
        isConnected: () => true,
        getDocuments: jest.fn().mockResolvedValue(docs),
      } as any;
      const handler = createToolHandler(client);
      const response = await handler({
        params: { name: "get_actors", arguments: { offset: 3, limit: 4 } },
      });
      const body = JSON.parse((response as any).content[0].text);
      expect(body).toHaveLength(4);
      expect(body[0]._id).toBe("a3");
      expect(body[3]._id).toBe("a6");
    });
  });

  describe("draw_from_table", () => {
    const critTable = {
      _id: "tb1",
      name: "🩸 Blessures critiques (d100)",
      formula: "1d100",
      results: [
        { _id: "r1", range: [1, 9], description: "Stress mécanique · Facile" },
        { _id: "r2", range: [10, 100], description: "Plus grave" },
      ],
    };

    test("tire, sélectionne par plage et poste en chat", async () => {
      const client = {
        isConnected: () => true,
        getUserId: () => "bot1",
        getDocument: jest.fn().mockResolvedValue(critTable),
        createDocument: jest.fn().mockResolvedValue({ ok: true }),
      } as any;
      const handler = createToolHandler(client);
      const response = await handler({
        params: { name: "draw_from_table", arguments: { table: "tb1" } },
      });
      const body = JSON.parse((response as any).content[0].text);
      expect(body.draws).toHaveLength(1);
      const d = body.draws[0];
      expect(d.roll).toBeGreaterThanOrEqual(1);
      expect(d.roll).toBeLessThanOrEqual(100);
      expect(d.text).toBe(d.roll <= 9 ? "Stress mécanique · Facile" : "Plus grave");
      expect(body.posted).toBe(true);
      expect(client.createDocument).toHaveBeenCalledWith("ChatMessage", [
        expect.objectContaining({ author: "bot1", content: expect.stringContaining(critTable.name) }),
      ]);
    });

    test("modificateur appliqué et tirages multiples sans post", async () => {
      const client = {
        isConnected: () => true,
        getUserId: () => "bot1",
        getDocument: jest.fn().mockResolvedValue(critTable),
        createDocument: jest.fn(),
      } as any;
      const handler = createToolHandler(client);
      const response = await handler({
        params: { name: "draw_from_table", arguments: { table: "tb1", modifier: 50, rolls: 3, post: false } },
      });
      const body = JSON.parse((response as any).content[0].text);
      expect(body.draws).toHaveLength(3);
      for (const d of body.draws) {
        expect(d.roll).toBeGreaterThanOrEqual(51);
        expect(d.text).toBe(d.roll <= 100 ? "Plus grave" : null);
      }
      expect(client.createDocument).not.toHaveBeenCalled();
    });

    test("formule non supportée → erreur explicite", async () => {
      const client = {
        isConnected: () => true,
        getDocument: jest.fn().mockResolvedValue({ ...critTable, formula: "1d20+@fx" }),
      } as any;
      const handler = createToolHandler(client);
      const response = await handler({ params: { name: "draw_from_table", arguments: { table: "tb1" } } });
      expect((response as any).isError).toBe(true);
    });
  });

  describe("lot 2 : tokens, conditions, demandes de jets", () => {
    const sceneWithTokens = {
      _id: "sc1",
      name: "Toydaria",
      tokens: [
        { _id: "t1", name: "Uchebe", x: 100, y: 200, hidden: false, actorId: "a1", actorLink: true, disposition: 1 },
        { _id: "t2", name: "Drengir", x: 300, y: 400, hidden: true, actorId: "a2", actorLink: false, disposition: -1 },
      ],
    };

    test("createToolDefinitions includes lot 2 tools", () => {
      const tools = createToolDefinitions();
      for (const name of [
        "list_tokens",
        "move_token",
        "update_token",
        "toggle_actor_condition",
        "draw_from_table",
      ]) {
        expect(tools.find((tool) => tool.name === name)).toBeDefined();
      }
    });

    test("list_tokens defaults to the active scene", async () => {
      const client = {
        isConnected: () => true,
        getDocuments: jest.fn().mockResolvedValue([sceneWithTokens]),
      } as any;
      const handler = createToolHandler(client);
      const response = await handler({ params: { name: "list_tokens", arguments: {} } });
      expect(client.getDocuments).toHaveBeenCalledWith("scenes", expect.objectContaining({
        where: { active: true },
      }));
      const body = JSON.parse((response as any).content[0].text);
      expect(body.scene.name).toBe("Toydaria");
      expect(body.tokens).toHaveLength(2);
      expect(body.tokens[0]).toMatchObject({ _id: "t1", name: "Uchebe", x: 100 });
    });

    test("move_token resolves token by name and updates embedded doc", async () => {
      const client = {
        isConnected: () => true,
        getDocuments: jest.fn().mockResolvedValue([sceneWithTokens]),
        modifyDocument: jest.fn().mockResolvedValue({ ok: true }),
      } as any;
      const handler = createToolHandler(client);
      const response = await handler({
        params: { name: "move_token", arguments: { token: "Uchebe", x: 500, y: 600 } },
      });
      expect(client.modifyDocument).toHaveBeenCalledWith("Token", "t1", [{ x: 500, y: 600 }], {
        parentUuid: "Scene.sc1",
      });
      expect((response as any).isError).toBeUndefined();
    });

    test("move_token errors on unknown token", async () => {
      const client = {
        isConnected: () => true,
        getDocuments: jest.fn().mockResolvedValue([sceneWithTokens]),
      } as any;
      const handler = createToolHandler(client);
      const response = await handler({
        params: { name: "move_token", arguments: { token: "Nope", x: 1 } },
      });
      expect((response as any).isError).toBe(true);
    });

    test("update_token applies arbitrary fields", async () => {
      const client = {
        isConnected: () => true,
        getDocuments: jest.fn().mockResolvedValue([sceneWithTokens]),
        modifyDocument: jest.fn().mockResolvedValue({ ok: true }),
      } as any;
      const handler = createToolHandler(client);
      await handler({
        params: { name: "update_token", arguments: { token: "t2", updates: { hidden: false } } },
      });
      expect(client.modifyDocument).toHaveBeenCalledWith("Token", "t2", [{ hidden: false }], {
        parentUuid: "Scene.sc1",
      });
    });

    test("toggle_actor_condition adds an ActiveEffect", async () => {
      const client = {
        isConnected: () => true,
        getDocument: jest.fn().mockResolvedValue({ _id: "a1", name: "Uchebe", effects: [] }),
        createDocument: jest.fn().mockResolvedValue({ ok: true }),
      } as any;
      const handler = createToolHandler(client);
      const response = await handler({
        params: { name: "toggle_actor_condition", arguments: { name: "Uchebe", condition: "stun", active: true } },
      });
      expect(client.createDocument).toHaveBeenCalledWith(
        "ActiveEffect",
        [{ name: "Stunned", img: "icons/svg/daze.svg", statuses: ["stun"] }],
        { parentUuid: "Actor.a1" }
      );
      expect((response as any).isError).toBeUndefined();
    });

    test("toggle_actor_condition removes matching effects", async () => {
      const client = {
        isConnected: () => true,
        getDocument: jest.fn().mockResolvedValue({
          _id: "a1",
          name: "Uchebe",
          effects: [
            { _id: "e1", statuses: ["stun"] },
            { _id: "e2", statuses: ["prone"] },
          ],
        }),
        deleteDocument: jest.fn().mockResolvedValue({ ok: true }),
      } as any;
      const handler = createToolHandler(client);
      await handler({
        params: { name: "toggle_actor_condition", arguments: { _id: "a1", condition: "stun", active: false } },
      });
      expect(client.deleteDocument).toHaveBeenCalledWith("ActiveEffect", ["e1"], {
        parentUuid: "Actor.a1",
      });
    });

    test("toggle_actor_condition is idempotent", async () => {
      const client = {
        isConnected: () => true,
        getDocument: jest.fn().mockResolvedValue({ _id: "a1", name: "Uchebe", effects: [{ _id: "e1", statuses: ["stun"] }] }),
        createDocument: jest.fn(),
      } as any;
      const handler = createToolHandler(client);
      const response = await handler({
        params: { name: "toggle_actor_condition", arguments: { _id: "a1", condition: "stun", active: true } },
      });
      expect(client.createDocument).not.toHaveBeenCalled();
      const body = JSON.parse((response as any).content[0].text);
      expect(body.unchanged).toBe("already active");
    });

    test("toggle_actor_condition rejects unknown conditions", async () => {
      const client = { isConnected: () => true } as any;
      const handler = createToolHandler(client);
      const response = await handler({
        params: { name: "toggle_actor_condition", arguments: { _id: "a1", condition: "zzz", active: true } },
      });
      expect((response as any).isError).toBe(true);
    });


    test("control_playlist stop mirrors Playlist#stopAll", async () => {
      const client = {
        isConnected: () => true,
        getDocument: jest.fn().mockResolvedValue({
          _id: "pl1", name: "Ambiance", mode: 0,
          sounds: [{ _id: "s1", name: "Thème", sort: 0 }, { _id: "s2", name: "Combat", sort: 1 }],
        }),
        modifyDocument: jest.fn().mockResolvedValue({ ok: true }),
      } as any;
      const handler = createToolHandler(client);
      await handler({ params: { name: "control_playlist", arguments: { playlist: "Ambiance", action: "stop" } } });
      expect(client.modifyDocument).toHaveBeenCalledWith("Playlist", "pl1", [
        { playing: false, sounds: [{ _id: "s1", playing: false }, { _id: "s2", playing: false }] },
      ]);
    });

    test("control_playlist play (sequential) starts the first sound", async () => {
      const client = {
        isConnected: () => true,
        getDocument: jest.fn().mockResolvedValue({
          _id: "pl1", name: "Ambiance", mode: 0,
          sounds: [{ _id: "s2", name: "Combat", sort: 1 }, { _id: "s1", name: "Thème", sort: 0 }],
        }),
        modifyDocument: jest.fn().mockResolvedValue({ ok: true }),
      } as any;
      const handler = createToolHandler(client);
      const response = await handler({ params: { name: "control_playlist", arguments: { playlist: "pl1", action: "play" } } });
      expect(client.modifyDocument).toHaveBeenCalledWith("Playlist", "pl1", [
        { playing: true, sounds: [{ _id: "s1", playing: true }, { _id: "s2", playing: false }] },
      ]);
      const body = JSON.parse((response as any).content[0].text);
      expect(body.playing).toEqual(["Thème"]);
    });

    test("manage_combat create builds combat + combatants from scene tokens", async () => {
      const client = {
        isConnected: () => true,
        getDocuments: jest.fn().mockResolvedValue([{
          _id: "sc1", name: "Toydaria", active: true,
          tokens: [
            { _id: "t1", name: "Uchebe", actorId: "a1", hidden: false },
            { _id: "t2", name: "Décor", actorId: null },
          ],
        }]),
        createDocument: jest.fn()
          .mockResolvedValueOnce({ result: [{ _id: "cb1" }] })
          .mockResolvedValueOnce({ result: [{ _id: "cbt1" }] }),
      } as any;
      const handler = createToolHandler(client);
      const response = await handler({ params: { name: "manage_combat", arguments: { action: "create" } } });
      expect(client.createDocument).toHaveBeenNthCalledWith(1, "Combat", [{ scene: "sc1", active: true }]);
      expect(client.createDocument).toHaveBeenNthCalledWith(2, "Combatant",
        [{ tokenId: "t1", sceneId: "sc1", actorId: "a1", hidden: false }],
        { parentUuid: "Combat.cb1" });
      const body = JSON.parse((response as any).content[0].text);
      expect(body.combat).toBe("cb1");
      expect(body.combatants).toEqual(["Uchebe"]);
    });

    test("manage_combat next_turn wraps to next round", async () => {
      const client = {
        isConnected: () => true,
        getDocuments: jest.fn().mockResolvedValue([{
          _id: "cb1", active: true, round: 1, turn: 1,
          combatants: [
            { _id: "c1", name: "A", initiative: 15 },
            { _id: "c2", name: "B", initiative: 10 },
          ],
        }]),
        modifyDocument: jest.fn().mockResolvedValue({ ok: true }),
      } as any;
      const handler = createToolHandler(client);
      const response = await handler({ params: { name: "manage_combat", arguments: { action: "next_turn" } } });
      expect(client.modifyDocument).toHaveBeenCalledWith("Combat", "cb1", [{ round: 2, turn: 0 }]);
      const body = JSON.parse((response as any).content[0].text);
      expect(body.current).toBe("A");
    });

    test("place_token merges the prototype token", async () => {
      const client = {
        isConnected: () => true,
        getDocument: jest.fn().mockResolvedValue({
          _id: "a1", name: "Uchebe",
          prototypeToken: { name: "Uchebe", width: 1, height: 1, actorLink: true, disposition: 1 },
        }),
        getDocuments: jest.fn().mockResolvedValue([{ _id: "sc1", name: "Toydaria", active: true }]),
        createDocument: jest.fn().mockResolvedValue({ result: [{ _id: "t9" }] }),
      } as any;
      const handler = createToolHandler(client);
      await handler({ params: { name: "place_token", arguments: { actor: "Uchebe", x: 300, y: 400 } } });
      expect(client.createDocument).toHaveBeenCalledWith("Token", [
        expect.objectContaining({ name: "Uchebe", actorId: "a1", x: 300, y: 400, actorLink: true }),
      ], { parentUuid: "Scene.sc1" });
    });


    test("cc_create_sheet builds the npc flag structure", async () => {
      const client = {
        isConnected: () => true,
        getDocument: jest.fn().mockResolvedValue({ _id: "a1", name: "Jerserra" }),
        createDocument: jest.fn().mockResolvedValue({ result: [{ _id: "j9" }] }),
      } as any;
      const handler = createToolHandler(client);
      const response = await handler({
        params: {
          name: "cc_create_sheet",
          arguments: { name: "Jerserra (fiche)", type: "npc", description: "<p>Antagoniste</p>", linked_actor: "Jerserra" },
        },
      });
      expect(client.createDocument).toHaveBeenCalledWith("JournalEntry", [
        expect.objectContaining({
          name: "Jerserra (fiche)",
          flags: {
            "campaign-codex": expect.objectContaining({
              type: "npc",
              data: expect.objectContaining({
                description: "<p>Antagoniste</p>",
                linkedActor: "Actor.a1",
                tagMode: false,
              }),
            }),
          },
          ownership: { default: 2 },
        }),
      ]);
      const body = JSON.parse((response as any).content[0].text);
      expect(body.created._id).toBe("j9");
    });

    test("cc_link appends to associates without duplicating", async () => {
      const sheets: Record<string, any> = {
        A: { _id: "jA", name: "A", flags: { "campaign-codex": { type: "npc", data: { associates: ["JournalEntry.jX"] } } } },
        B: { _id: "jB", name: "B", flags: { "campaign-codex": { type: "group", data: { associates: [] } } } },
      };
      const client = {
        isConnected: () => true,
        getDocument: jest.fn().mockImplementation((_c: string, ident: any) => sheets[ident._id] ?? sheets[ident.name] ?? null),
        modifyDocument: jest.fn().mockResolvedValue({ ok: true }),
      } as any;
      const handler = createToolHandler(client);
      await handler({ params: { name: "cc_link", arguments: { from: "A", to: "B" } } });
      expect(client.modifyDocument).toHaveBeenCalledWith("JournalEntry", "jA", [
        { flags: { "campaign-codex": { data: { associates: ["JournalEntry.jX", "JournalEntry.jB"] } } } },
      ]);
    });

    test("wait_for_message matches created chat messages", async () => {
      const client = {
        isConnected: () => true,
        getEventSeq: () => 5,
        waitForEvent: jest.fn().mockImplementation(async (predicate: any) =>
          predicate({
            seq: 6, t: 0, event: "modifyDocument",
            args: [{ type: "ChatMessage", action: "create", result: [{ _id: "m1", content: "jet !" }] }],
          })
        ),
      } as any;
      const handler = createToolHandler(client);
      const response = await handler({ params: { name: "wait_for_message", arguments: {} } });
      const body = JSON.parse((response as any).content[0].text);
      expect(body.timeout).toBe(false);
      expect(body.messages[0]._id).toBe("m1");
    });

    test("wait_for_message reports timeout", async () => {
      const client = {
        isConnected: () => true,
        getEventSeq: () => 5,
        waitForEvent: jest.fn().mockResolvedValue(undefined),
      } as any;
      const handler = createToolHandler(client);
      const response = await handler({ params: { name: "wait_for_message", arguments: { timeout_seconds: 1 } } });
      const body = JSON.parse((response as any).content[0].text);
      expect(body.timeout).toBe(true);
    });

  });
});
