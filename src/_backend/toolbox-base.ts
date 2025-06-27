import type { DataStore, AuthProvider } from "./types";

import { randomUUID } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";

import { StreamableHTTPClientTransport } from "./streamableHttp";
import { AuthorizationError } from "./authorization-error";

type ServerData = {
  id: string;
  url: string;
  authorization: {
    protectedResourceMetadata: any;
    protectedResourceMetadataError: string | null;
    authorizationServerUrl: string;
    authorizationServerMetadata: any;
    authorizationServerError: string | null;
    unauthedWwwAuthenticate: string | null;
    unauthedStatusCode: number | null;
    registrationError: string | null;
  };
};

type ToolboxProps = {
  contextId?: string;
  store: DataStore;
  auth: AuthProvider;
};

export class ToolboxBase {
  private readonly contextId: string;
  private readonly store: DataStore;
  private readonly auth: AuthProvider;
  private transports: Record<string, StreamableHTTPClientTransport> = {};

  constructor({ contextId, store, auth }: ToolboxProps) {
    this.contextId = contextId ?? auth.userId;
    this.store = store;
    this.auth = auth;
  }

  async successResponse() {
    return await Response.json(await this.readFullToolboxContext());
  }

  async handleGet(request: Request) {
    const url = new URL(request.url);
    const searchParams = url.searchParams;
    if (searchParams.get("action") === "read_toolbox") {
      return await this.successResponse();
    }
    if (searchParams.get("action") === "oauth_callback") {
      if (this.auth.handleAuthorizationCallback) {
        const toolboxCallbackUrl = this.computeToolboxCallbackUrl(request);
        const result = await this.auth.handleAuthorizationCallback(
          request,
          toolboxCallbackUrl
        );
        return Response.redirect(result.finalRedirectUrl);
      } else {
        return Response.json({ error: "Not implemented" }, { status: 400 });
      }
    }
    return Response.json({ error: "Unknown action" }, { status: 400 });
  }

  async handlePost(request: Request) {
    const url = new URL(request.url);
    const searchParams = url.searchParams;
    const requestBody = await request.formData();
    if (searchParams.get("action") === "add_server") {
      const toolboxCallbackUrl = this.computeToolboxCallbackUrl(request);
      await this.addMcpServer({
        endpoint: requestBody.get("url") as string,
        toolboxCallbackUrl,
      });
      return await this.successResponse();
    }
    if (searchParams.get("action") === "retry_discovery") {
      const serverId = requestBody.get("serverId") as string;
      if (!serverId) {
        return Response.json(
          { error: "serverId is required" },
          { status: 400 }
        );
      }
      const toolboxCallbackUrl = this.computeToolboxCallbackUrl(request);
      await this.retryDiscovery(serverId, toolboxCallbackUrl);
      return await this.successResponse();
    }
    if (searchParams.get("action") === "generate_authorization_url") {
      const serverId = requestBody.get("serverId") as string;
      const scopes = requestBody.get("scopes") as string;
      const finalRedirectUrl = requestBody.get("finalRedirectUrl") as string;
      if (!serverId) {
        return Response.json(
          { error: "serverId is required" },
          { status: 400 }
        );
      }
      if (!finalRedirectUrl) {
        return Response.json(
          { error: "finalRedirectUrl is required" },
          { status: 400 }
        );
      }

      const toolboxCallbackUrl = this.computeToolboxCallbackUrl(request);

      // Validate finalRedirectUrl using same-site methodology
      const isValidFinalRedirectUrl = await this.auth.validateFinalRedirectUrl(
        finalRedirectUrl,
        toolboxCallbackUrl
      );

      if (!isValidFinalRedirectUrl) {
        return Response.json(
          {
            error: `Final redirect URL ${finalRedirectUrl} is not valid for toolbox callback URL ${toolboxCallbackUrl}. URLs must be same-site.`,
          },
          { status: 400 }
        );
      }

      const result = await this.generateAuthorizationUrl({
        serverId,
        scopes: scopes ? scopes.split(" ") : undefined,
        toolboxCallbackUrl,
        finalRedirectUrl,
      });

      if ("error" in result) {
        return Response.json({ error: result.error }, { status: 400 });
      }

      return Response.json({ authorizationUrl: result.authorizationUrl });
    }
    return Response.json({ error: "Unknown action" }, { status: 400 });
  }

  getScopedStorageKey(key: string) {
    return `toolbox_${this.contextId}_${key}`;
  }

  private computeToolboxCallbackUrl(request: Request): string {
    const toolboxCallbackUrl = new URL(request.url);

    console.log("Starting with", toolboxCallbackUrl.toString());

    // Delete all search params
    toolboxCallbackUrl.search = "";

    // Add action=oauth_callback
    toolboxCallbackUrl.searchParams.set("action", "oauth_callback");

    console.log("Returning", toolboxCallbackUrl.toString());
    return toolboxCallbackUrl.toString();
  }

  async readFullToolboxContext() {
    const serverList = await this.readServerList();
    const servers = await Promise.all(
      serverList.map(async (server) => {
        const oauthMetadata = server.authorization.authorizationServerMetadata;
        const computedStatus = await this.computeAuthorizationStatus(server);

        return {
          id: server.id,
          url: server.url,
          authorization: {
            ...server.authorization,
            status: computedStatus,
          },
          hasAccessToken: oauthMetadata
            ? await this.auth.hasAccessToken({
                authorizationServerUrl: oauthMetadata.authorization_endpoint,
              })
            : false,
        };
      })
    );
    return {
      servers,
    };
  }

  private async computeAuthorizationStatus(
    server: ServerData
  ): Promise<
    | "not_required"
    | "discovery_failed"
    | "requires_registration"
    | "requires_connection"
    | "connected"
  > {
    // If unauthedStatusCode = 200, status=not_required
    if (server.authorization.unauthedStatusCode === 200) {
      return "not_required";
    }

    // If authorizationServerError != null or protectedResourceMetadataError != null, status=discovery_failed
    if (
      server.authorization.authorizationServerError !== null ||
      server.authorization.protectedResourceMetadataError !== null
    ) {
      return "discovery_failed";
    }

    // If no authorization server metadata, we can't determine auth status
    if (!server.authorization.authorizationServerMetadata) {
      return "discovery_failed";
    }

    const oauthMetadata = server.authorization.authorizationServerMetadata;
    const hasAccessToken = await this.auth.hasAccessToken({
      authorizationServerUrl: oauthMetadata.authorization_endpoint,
    });

    // If auth.hasAccessToken, status=connected
    if (hasAccessToken) {
      return "connected";
    }

    const isRegistered = await this.auth.isRegistered({
      authorizationServerUrl: oauthMetadata.authorization_endpoint,
    });

    // If auth.isRegistered and !auth.hasAccessToken, status=requires_connection
    if (isRegistered) {
      return "requires_connection";
    }

    // If !auth.isRegistered and !auth.hasAccessToken, status=requires_registration
    return "requires_registration";
  }

  async readServerList() {
    return (
      ((await this.store.read(
        this.getScopedStorageKey("serverlist")
      )) as ServerData[]) || ([] as ServerData[])
    );
  }

  private async writeServerList(servers: ServerData[]) {
    return await this.store.write(
      this.getScopedStorageKey("serverlist"),
      servers
    );
  }

  async readServer(serverId: string) {
    return (await this.store.read(
      this.getScopedStorageKey(`server_${serverId}`)
    )) as ServerData;
  }

  private async writeServer(serverId: string, server: ServerData) {
    return await this.store.write(
      this.getScopedStorageKey(`server_${serverId}`),
      server
    );
  }

  async addMcpServer({
    endpoint,
    toolboxCallbackUrl,
  }: {
    endpoint: string;
    toolboxCallbackUrl?: string;
  }) {
    // Check if it's on the list already
    let serverList = await this.readServerList();
    if (serverList.some((server) => server.url === endpoint)) {
      return;
    }

    // Generate a UUID for the server
    const serverId = randomUUID();

    // Create the server data object with default values
    const serverData: ServerData = {
      id: serverId,
      url: endpoint,
      authorization: {
        protectedResourceMetadata: {},
        protectedResourceMetadataError: null,
        authorizationServerUrl: "",
        authorizationServerMetadata: {},
        authorizationServerError: null,
        unauthedWwwAuthenticate: null,
        unauthedStatusCode: null,
        registrationError: null,
      },
    };

    // Attempt connection and discovery
    await this.attemptConnectionAndDiscovery(serverData);

    // If discovery was successful and registration is required, attempt registration
    if (
      serverData.authorization.authorizationServerMetadata &&
      !serverData.authorization.authorizationServerError &&
      !serverData.authorization.protectedResourceMetadataError &&
      toolboxCallbackUrl
    ) {
      const status = await this.computeAuthorizationStatus(serverData);
      if (status === "requires_registration") {
        const result = await this.registerClient(
          serverData,
          toolboxCallbackUrl
        );
        if ("error" in result) {
          serverData.authorization.registrationError = result.error;
        }
      }
    }

    // Save the server to the list and store with the determined requires_auth value
    await this.writeServerList([...serverList, serverData]);
    await this.writeServer(serverId, serverData);

    return;
  }

  async generateAuthorizationUrl({
    serverId,
    scopes,
    toolboxCallbackUrl,
    finalRedirectUrl,
  }: {
    serverId: string;
    scopes?: string[];
    toolboxCallbackUrl: string;
    finalRedirectUrl: string;
  }): Promise<{ authorizationUrl: string } | { error: string }> {
    const serverData = await this.readServer(serverId);
    if (!serverData || !serverData.authorization.authorizationServerMetadata) {
      return { error: "Could not find authorization server" };
    }

    return this.auth.generateAuthorizationUrl({
      oauthMetadata: serverData.authorization.authorizationServerMetadata,
      scopes,
      toolboxCallbackUrl,
      finalRedirectUrl,
    });
  }

  private async registerClient(
    serverData: ServerData,
    toolboxCallbackUrl: string
  ): Promise<{ success: true } | { error: string }> {
    if (!serverData.authorization.authorizationServerMetadata) {
      return { error: "Could not find authorization server" };
    }

    const result = await this.auth.registerDynamically({
      oauthMetadata: serverData.authorization.authorizationServerMetadata,
      toolboxCallbackUrl,
    });

    if ("error" in result) {
      return { error: result.error };
    }

    // Update the server in storage
    await this.writeServer(serverData.id, serverData);

    // Update the server in the list
    const serverList = await this.readServerList();
    const updatedServerList = serverList.map((server) =>
      server.id === serverData.id ? serverData : server
    );
    await this.writeServerList(updatedServerList);

    return { success: true };
  }

  private async getTransport(mcpServerUrl: string) {
    if (this.transports[mcpServerUrl]) {
      return this.transports[mcpServerUrl];
    }

    const serverData = await this.findServerByUrl(mcpServerUrl);
    if (!serverData || !serverData.authorization.authorizationServerMetadata) {
      throw new Error("Could not find authorization server");
    }

    const oauthMetadata = serverData.authorization.authorizationServerMetadata;

    this.transports[mcpServerUrl] = new StreamableHTTPClientTransport(
      new URL(mcpServerUrl),
      {
        authProvider: {
          getAccessToken: () => {
            return this.auth.getAccessToken({
              authorizationServerUrl: oauthMetadata.authorization_endpoint,
            });
          },
          refreshAccessToken: async () => {
            // TODO: Implement a real refresh
            await this.auth.getAccessToken({
              authorizationServerUrl: oauthMetadata.authorization_endpoint,
            });
          },
        },
      }
    );
    return this.transports[mcpServerUrl];
  }

  async callTool({
    mcpServerUrl,
    toolName,
    toolArguments,
  }: {
    mcpServerUrl: string;
    toolName: string;
    toolArguments: Record<string, unknown>;
  }) {
    const serverData = await this.findServerByUrl(mcpServerUrl);
    if (!serverData || !serverData.authorization.authorizationServerMetadata) {
      throw new Error("Could not find authorization server");
    }

    const mcpClient = new Client({
      name: "client.mcpClientName",
      version: "0.0.1",
    });

    const transport = await this.getTransport(mcpServerUrl);

    await mcpClient.connect(transport);

    return await mcpClient.callTool({
      name: toolName,
      arguments: toolArguments,
    });
  }

  async removeMcpServer({ endpoint }: { endpoint: string }) {}

  async listMcpServers() {}

  async listTools() {}

  private async findServerByUrl(url: string): Promise<ServerData | undefined> {
    const serverList = await this.readServerList();
    return serverList.find((server) => server.url === url);
  }

  async retryDiscovery(serverId: string, toolboxCallbackUrl: string) {
    // Get the server data
    const serverData = await this.readServer(serverId);
    if (!serverData) {
      throw new Error(`Server with ID ${serverId} not found`);
    }

    console.log("Retrying discovery for", serverData.url);

    // Reset the authorization data for retry
    serverData.authorization.protectedResourceMetadata = {};
    serverData.authorization.protectedResourceMetadataError = null;
    serverData.authorization.authorizationServerUrl = "";
    serverData.authorization.authorizationServerMetadata = {};
    serverData.authorization.authorizationServerError = null;
    serverData.authorization.unauthedWwwAuthenticate = null;
    serverData.authorization.unauthedStatusCode = null;
    serverData.authorization.registrationError = null;

    // Attempt connection and discovery
    await this.attemptConnectionAndDiscovery(serverData);

    // If discovery was successful and registration is required, attempt registration
    if (
      serverData.authorization.authorizationServerMetadata &&
      !serverData.authorization.authorizationServerError &&
      !serverData.authorization.protectedResourceMetadataError
    ) {
      const status = await this.computeAuthorizationStatus(serverData);
      if (status === "requires_registration") {
        const result = await this.registerClient(
          serverData,
          toolboxCallbackUrl
        );
        if ("error" in result) {
          serverData.authorization.registrationError = result.error;
        }
      }
    }

    console.log("End retry discovery attempt", serverData.url);

    // Update the server in the list and store
    const serverList = await this.readServerList();
    const updatedServerList = serverList.map((server) =>
      server.id === serverId ? serverData : server
    );
    await this.writeServerList(updatedServerList);
    await this.writeServer(serverId, serverData);

    return;
  }

  private async attemptConnectionAndDiscovery(serverData: ServerData) {
    console.log("Connecting to", serverData.url);

    const mcpClient = new Client({
      name: "client.mcpClientName",
      version: "0.0.1",
    });
    const transport = new StreamableHTTPClientTransport(
      new URL(serverData.url)
    );

    try {
      await mcpClient.connect(transport);
      // Connection succeeded, no auth required
      serverData.authorization.protectedResourceMetadata = {};
      serverData.authorization.protectedResourceMetadataError = null;
      serverData.authorization.authorizationServerUrl = "";
      serverData.authorization.authorizationServerMetadata = {};
      serverData.authorization.authorizationServerError = null;
      serverData.authorization.unauthedWwwAuthenticate = null;
      serverData.authorization.unauthedStatusCode = 200;
      console.log("Connection successful - no auth required");
    } catch (e) {
      // Connection failed, auth likely required
      if (e instanceof AuthorizationError) {
        console.log(
          "Authorization error - auth required",
          e.message,
          e.response,
          e.request
        );

        // Try to discover metadata using the WWW-Authenticate header
        const wwwAuthenticate = e.response.headers.get("WWW-Authenticate");
        serverData.authorization.unauthedWwwAuthenticate = wwwAuthenticate;
        serverData.authorization.unauthedStatusCode = e.response.status || null;

        if (wwwAuthenticate) {
          console.log(
            "Attempting to discover authorization server from WWW-Authenticate header"
          );

          try {
            const discoveryResult =
              await this.auth.discoverAuthorizationServerFromWWWAuthenticate(
                wwwAuthenticate,
                serverData.url
              );

            // Copy all fields from discovery result
            serverData.authorization.authorizationServerUrl =
              discoveryResult.authorizationServerUrl;
            serverData.authorization.protectedResourceMetadata =
              discoveryResult.protectedResourceMetadata;
            serverData.authorization.protectedResourceMetadataError =
              discoveryResult.protectedResourceMetadataError;
            serverData.authorization.authorizationServerMetadata =
              discoveryResult.authorizationServerMetadata;
            serverData.authorization.authorizationServerError =
              discoveryResult.authorizationServerError;

            // If discovery was successful (no errors), log success
            if (
              !discoveryResult.protectedResourceMetadataError &&
              !discoveryResult.authorizationServerError
            ) {
              console.log(
                "Successfully discovered authorization server:",
                discoveryResult.authorizationServerUrl
              );
            } else {
              console.warn(
                "Discovery completed with errors:",
                discoveryResult.protectedResourceMetadataError ||
                  discoveryResult.authorizationServerError
              );
            }
          } catch (discoveryError) {
            console.warn("Error during metadata discovery:", discoveryError);
            serverData.authorization.authorizationServerError = `Discovery error: ${discoveryError}`;
          }
        } else {
          console.log(
            "No WWW-Authenticate header found, cannot discover metadata"
          );
          serverData.authorization.authorizationServerError =
            "No WWW-Authenticate header provided";
        }
      } else {
        console.log("Connection failed - auth may be required", e);
        serverData.authorization.authorizationServerError =
          "Connection failed - not an authorization error";
        serverData.authorization.unauthedWwwAuthenticate = null;
        serverData.authorization.unauthedStatusCode = null;
      }
    }
  }
}
