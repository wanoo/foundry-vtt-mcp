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
        "request_player_roll",
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

    test("request_player_roll posts an FFG pool chat message", async () => {
      const client = {
        isConnected: () => true,
        getUserId: () => "bot1",
        createDocument: jest.fn().mockResolvedValue({ ok: true }),
      } as any;
      const handler = createToolHandler(client);
      const response = await handler({
        params: {
          name: "request_player_roll",
          arguments: { description: "Test de Peur", difficulty: 2, challenge: 1, skill_name: "Discipline" },
        },
      });
      expect(client.createDocument).toHaveBeenCalledWith("ChatMessage", [
        expect.objectContaining({
          author: "bot1",
          content: expect.stringContaining("ffg-pool-to-player"),
          flags: {
            starwarsffg: expect.objectContaining({
              dicePool: { difficulty: 2, challenge: 1 },
              description: "Test de Peur",
              roll: expect.objectContaining({ skillName: "Discipline" }),
            }),
          },
        }),
      ]);
      expect((response as any).isError).toBeUndefined();
    });

    test("request_player_roll supports whisper", async () => {
      const client = {
        isConnected: () => true,
        getUserId: () => "bot1",
        createDocument: jest.fn().mockResolvedValue({ ok: true }),
      } as any;
      const handler = createToolHandler(client);
      await handler({
        params: {
          name: "request_player_roll",
          arguments: { description: "Perception", ability: 2, whisper_users: ["u1"] },
        },
      });
      expect(client.createDocument).toHaveBeenCalledWith("ChatMessage", [
        expect.objectContaining({ whisper: ["u1"] }),
      ]);
    });
  });
});
