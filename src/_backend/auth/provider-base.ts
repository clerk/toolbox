import * as psl from "psl";

type DiscoveryOptions = {
  resourceVsProtectedResourceMetadata:
    | "any"
    | "same-site"
    | "same-origin"
    | "strict-spec"
    | ((
        resourceUri: string,
        protectedResourceMetadataUri: string
      ) => boolean | Promise<boolean>);
  resourceVsAuthorizationServer:
    | "any"
    | "same-site"
    | "same-origin"
    | ((
        resourceUri: string,
        authorizationServerUri: string
      ) => boolean | Promise<boolean>);
};

export class AuthProviderBase {
  discoveryOptions: DiscoveryOptions;
  constructor({
    discoveryOptions,
  }: {
    discoveryOptions?: Partial<DiscoveryOptions>;
  }) {
    this.discoveryOptions = {
      resourceVsProtectedResourceMetadata: "strict-spec",
      resourceVsAuthorizationServer: "same-site",
      ...discoveryOptions,
    };
  }

  async validateResourceVsProtectedResourceMetadata(
    resourceUri: string,
    protectedResourceMetadataUri: string
  ) {
    console.log(
      "Validating resource vs protected resource metadata",
      this.discoveryOptions.resourceVsProtectedResourceMetadata,
      resourceUri,
      protectedResourceMetadataUri
    );
    if (this.discoveryOptions.resourceVsProtectedResourceMetadata === "any") {
      return true;
    }
    if (
      this.discoveryOptions.resourceVsProtectedResourceMetadata === "same-site"
    ) {
      const resourceUrl = new URL(resourceUri);
      const metadataUrl = new URL(protectedResourceMetadataUri);
      return psl.get(resourceUrl.hostname) === psl.get(metadataUrl.hostname);
    }
    if (
      this.discoveryOptions.resourceVsProtectedResourceMetadata ===
      "same-origin"
    ) {
      const resourceUrl = new URL(resourceUri);
      const metadataUrl = new URL(protectedResourceMetadataUri);
      return resourceUrl.origin === metadataUrl.origin;
    }
    if (
      this.discoveryOptions.resourceVsProtectedResourceMetadata ===
      "strict-spec"
    ) {
      const metadataUrl = new URL(protectedResourceMetadataUri);

      // For strict-spec, the metadata URL must follow the well-known URI pattern
      // Construct the expected metadata URL based on the resource URL
      const expectedMetadataUrl = new URL(resourceUri);

      // Remove any trailing slash after the host component
      const pathWithoutTrailingSlash = expectedMetadataUrl.pathname.replace(
        /\/$/,
        ""
      );

      // Insert /.well-known/oauth-protected-resource between host and path
      if (pathWithoutTrailingSlash === "") {
        // No path component, just add the well-known path
        expectedMetadataUrl.pathname = "/.well-known/oauth-protected-resource";
      } else {
        // Has path component, insert well-known path before the existing path
        expectedMetadataUrl.pathname = `/.well-known/oauth-protected-resource${pathWithoutTrailingSlash}`;
      }

      return metadataUrl.href === expectedMetadataUrl.href;
    }
    if (
      typeof this.discoveryOptions.resourceVsProtectedResourceMetadata ===
      "function"
    ) {
      return this.discoveryOptions.resourceVsProtectedResourceMetadata(
        resourceUri,
        protectedResourceMetadataUri
      );
    }
  }

  async validateResourceVsAuthorizationServer(
    resourceUri: string,
    authorizationServerUri: string
  ) {
    if (this.discoveryOptions.resourceVsAuthorizationServer === "any") {
      return true;
    }
    if (this.discoveryOptions.resourceVsAuthorizationServer === "same-site") {
      const resourceUrl = new URL(resourceUri);
      const authServerUrl = new URL(authorizationServerUri);
      return psl.get(resourceUrl.hostname) === psl.get(authServerUrl.hostname);
    }
    if (this.discoveryOptions.resourceVsAuthorizationServer === "same-origin") {
      const resourceUrl = new URL(resourceUri);
      const authServerUrl = new URL(authorizationServerUri);
      return resourceUrl.origin === authServerUrl.origin;
    }
    if (
      typeof this.discoveryOptions.resourceVsAuthorizationServer === "function"
    ) {
      return this.discoveryOptions.resourceVsAuthorizationServer(
        resourceUri,
        authorizationServerUri
      );
    }
  }

  async validateFinalRedirectUrl(
    finalRedirectUrl: string,
    toolboxCallbackUrl: string
  ): Promise<boolean> {
    try {
      const finalUrl = new URL(finalRedirectUrl);
      const callbackUrl = new URL(toolboxCallbackUrl);

      // Use same-site validation (same registrable domain)
      return psl.get(finalUrl.hostname) === psl.get(callbackUrl.hostname);
    } catch (error) {
      // If URL parsing fails, the finalRedirectUrl is invalid
      return false;
    }
  }

  /**
   * Discovers the authorization server URL from a WWW-Authenticate header
   * based on RFC 9728, but uses the existing validation methods instead of
   * the precise spec.
   *
   * @param wwwAuthenticateHeader - The WWW-Authenticate header value
   * @param resourceUri - The URI of the protected resource that returned the header
   * @returns Object containing authorization server URL, protected resource metadata, and authorization server metadata, with error fields populated if discovery fails
   */
  async discoverAuthorizationServerFromWWWAuthenticate(
    wwwAuthenticateHeader: string,
    resourceUri: string
  ): Promise<{
    authorizationServerUrl: string;
    protectedResourceMetadata: any;
    protectedResourceMetadataError: string | null;
    authorizationServerMetadata: any;
    authorizationServerError: string | null;
  }> {
    console.log(
      "Discovering authorization server from the WWW-Authenticate header"
    );

    // Parse the WWW-Authenticate header
    const authScheme = wwwAuthenticateHeader.split(" ")[0];
    if (authScheme.toLowerCase() !== "bearer") {
      return {
        authorizationServerUrl: "",
        protectedResourceMetadata: {},
        protectedResourceMetadataError:
          "WWW-Authenticate header does not use Bearer scheme",
        authorizationServerMetadata: {},
        authorizationServerError: null,
      };
    }

    // Extract parameters from the header
    const params = this.parseWWWAuthenticateParams(wwwAuthenticateHeader);
    const resourceMetadataUrl = params.get("resource_metadata");

    if (!resourceMetadataUrl) {
      return {
        authorizationServerUrl: "",
        protectedResourceMetadata: {},
        protectedResourceMetadataError:
          "WWW-Authenticate header does not contain resource_metadata parameter",
        authorizationServerMetadata: {},
        authorizationServerError: null,
      };
    }

    // Validate the metadata URL against the resource URI before fetching
    const isValidMetadata =
      await this.validateResourceVsProtectedResourceMetadata(
        resourceUri,
        resourceMetadataUrl
      );

    if (!isValidMetadata) {
      const currentOption =
        this.discoveryOptions.resourceVsProtectedResourceMetadata;
      return {
        authorizationServerUrl: "",
        protectedResourceMetadata: {},
        protectedResourceMetadataError: `Protected resource metadata URL ${resourceMetadataUrl} is not valid for resource ${resourceUri} with current discovery option "${currentOption}". Consider changing the 'resourceVsProtectedResourceMetadata' discovery option, though this may not be safe as it bypasses validation.`,
        authorizationServerMetadata: {},
        authorizationServerError: null,
      };
    }

    try {
      // Fetch the protected resource metadata
      const response = await fetch(resourceMetadataUrl);
      if (!response.ok) {
        return {
          authorizationServerUrl: "",
          protectedResourceMetadata: {},
          protectedResourceMetadataError: `Failed to fetch protected resource metadata from ${resourceMetadataUrl}: ${response.status} ${response.statusText}`,
          authorizationServerMetadata: {},
          authorizationServerError: null,
        };
      }

      const protectedResourceMetadata = await response.json();

      // Extract authorization server URLs from metadata
      const authorizationServers =
        protectedResourceMetadata.authorization_servers;
      if (
        !Array.isArray(authorizationServers) ||
        authorizationServers.length === 0
      ) {
        return {
          authorizationServerUrl: "",
          protectedResourceMetadata: {},
          protectedResourceMetadataError:
            "Protected resource metadata does not contain any authorization_servers",
          authorizationServerMetadata: {},
          authorizationServerError: null,
        };
      }

      // Find the first valid authorization server and fetch its metadata
      for (const authServerUrl of authorizationServers) {
        const isValidAuthServer =
          await this.validateResourceVsAuthorizationServer(
            resourceUri,
            authServerUrl
          );

        if (isValidAuthServer) {
          try {
            // Fetch the authorization server metadata
            const authServerResponse = await fetch(
              `${authServerUrl}/.well-known/oauth-authorization-server`
            );
            if (!authServerResponse.ok) {
              console.warn(
                `Authorization server metadata not available at ${authServerUrl}/.well-known/oauth-authorization-server: ${authServerResponse.status} ${authServerResponse.statusText}`
              );
              continue; // Try the next authorization server
            }

            const authorizationServerMetadata = await authServerResponse.json();

            return {
              authorizationServerUrl: authServerUrl,
              protectedResourceMetadata,
              protectedResourceMetadataError: null,
              authorizationServerMetadata,
              authorizationServerError: null,
            };
          } catch (error) {
            console.warn(
              `Failed to fetch authorization server metadata from ${authServerUrl}:`,
              error
            );
            continue; // Try the next authorization server
          }
        }
      }

      const currentOption = this.discoveryOptions.resourceVsAuthorizationServer;
      return {
        authorizationServerUrl: "",
        protectedResourceMetadata,
        protectedResourceMetadataError: null,
        authorizationServerMetadata: {},
        authorizationServerError: `No valid authorization server found. Tried ${authorizationServers.length} servers but none were valid or had accessible metadata with current discovery option "${currentOption}". Consider changing the 'resourceVsAuthorizationServer' discovery option, though this may not be safe as it bypasses validation.`,
      };
    } catch (error) {
      return {
        authorizationServerUrl: "",
        protectedResourceMetadata: {},
        protectedResourceMetadataError: `Failed to discover authorization server from WWW-Authenticate header: ${error}`,
        authorizationServerMetadata: {},
        authorizationServerError: null,
      };
    }
  }

  /**
   * Parses parameters from a WWW-Authenticate header value.
   * Handles quoted and unquoted parameter values.
   *
   * @param headerValue - The WWW-Authenticate header value
   * @returns Map of parameter names to values
   */
  private parseWWWAuthenticateParams(headerValue: string): Map<string, string> {
    const params = new Map<string, string>();

    // Remove the auth scheme (e.g., "Bearer")
    const schemeEnd = headerValue.indexOf(" ");
    if (schemeEnd === -1) {
      return params;
    }

    const paramsString = headerValue.substring(schemeEnd + 1);

    // Simple parser for key=value pairs
    const paramRegex = /(\w+)=([^,\s]+|"[^"]*")/g;
    let match;

    while ((match = paramRegex.exec(paramsString)) !== null) {
      const key = match[1];
      let value = match[2];

      // Remove quotes if present
      if (value.startsWith('"') && value.endsWith('"')) {
        value = value.slice(1, -1);
      }

      params.set(key, value);
    }

    return params;
  }
}
