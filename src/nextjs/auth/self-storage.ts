import {
  discoverOAuthMetadata,
  exchangeAuthorization,
  registerClient,
  startAuthorization,
} from "@modelcontextprotocol/sdk/client/auth.js";
import type { DataStore, AuthProvider } from "../../_backend/types";
import {
  OAuthTokensSchema,
  type OAuthClientInformationFull,
  type OAuthMetadata,
  type OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import { randomUUID } from "node:crypto";
import { AuthProviderBase } from "../../_backend/auth/provider-base.js";

export class SelfStorageAuthProvider
  extends AuthProviderBase
  implements AuthProvider
{
  store: DataStore;
  oauthClientName: string;
  oauthClientUri: string;
  scopes: string[];
  userId: string;

  constructor({
    store,
    userId,
    oauthClientName,
    oauthClientUri,
    discoveryOptions,
  }: {
    store: DataStore;
    userId: string;
    oauthClientName: string;
    oauthClientUri: string;
    discoveryOptions?: Partial<{
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
    }>;
  }) {
    super({ discoveryOptions });
    this.store = store;
    this.oauthClientName = oauthClientName;
    this.oauthClientUri = oauthClientUri;
    this.scopes = ["openid", "profile", "email"];
    this.userId = userId;
  }

  private getTokensStorageKey(server: string) {
    return `cm_tokens_${this.userId}_${server}`;
  }

  private async getTokens(server: string) {
    const storageKey = this.getTokensStorageKey(server);
    const tokens = await this.store.read(storageKey);
    return tokens as OAuthTokens;
  }

  private async writeTokens(server: string, tokens: OAuthTokens) {
    const storageKey = this.getTokensStorageKey(server);
    await this.store.write(storageKey, tokens);
  }

  private getRegistrationStorageKey(server: string) {
    return `cm_registration_${server}`;
  }

  private getStateStorageKey(state: string) {
    return `cm_state_${state}`;
  }

  async registerDynamically({
    oauthMetadata,
    toolboxCallbackUrl,
  }: {
    oauthMetadata: OAuthMetadata;
    toolboxCallbackUrl: string;
  }): Promise<OAuthClientInformationFull | { error: string }> {
    const storageKey = this.getRegistrationStorageKey(
      oauthMetadata.authorization_endpoint
    );

    try {
      const dynamicRegistration = await registerClient(
        oauthMetadata.authorization_endpoint,
        {
          metadata: oauthMetadata,
          clientMetadata: {
            client_name: this.oauthClientName,
            client_uri: this.oauthClientUri,
            redirect_uris: [toolboxCallbackUrl],
          },
        }
      );

      await this.store.write(storageKey, dynamicRegistration);
      return dynamicRegistration;
    } catch (error) {
      console.error("Failed to register OAuth client:", error);
      return {
        error:
          error instanceof Error
            ? error.message
            : "Failed to register OAuth client",
      };
    }
  }

  // This is for SelfStorage, but if the OAuth manager is external like Clerk, you'd
  // just make an API request instead
  private async getRegistrationData({
    oauthMetadata,
    toolboxCallbackUrl,
  }: {
    oauthMetadata: OAuthMetadata;
    toolboxCallbackUrl: string;
  }): Promise<OAuthClientInformationFull | { error: string }> {
    const storageKey = this.getRegistrationStorageKey(
      oauthMetadata.authorization_endpoint
    );
    const registration = await this.store.read(storageKey);

    // If already registered, return it right away
    if (registration) {
      return registration as OAuthClientInformationFull;
    }

    // If not, we need to register the client.
    // Use the MCP SDK for convenience but this is just oauth
    try {
      const dynamicRegistration = await registerClient(
        oauthMetadata.authorization_endpoint,
        {
          metadata: oauthMetadata,
          clientMetadata: {
            client_name: this.oauthClientName,
            client_uri: this.oauthClientUri,
            redirect_uris: [toolboxCallbackUrl],
          },
        }
      );

      await this.store.write(storageKey, dynamicRegistration);
      return dynamicRegistration;
    } catch (error) {
      console.error("Failed to register OAuth client:", error);
      return {
        error:
          error instanceof Error
            ? error.message
            : "Failed to register OAuth client",
      };
    }
  }

  private async getStateData(state: string): Promise<{
    authorizationEndpoint: string;
    codeVerifier: string;
    finalRedirectUrl: string;
  }> {
    const stateStorageKey = this.getStateStorageKey(state);
    const stateData = await this.store.read(stateStorageKey);
    return stateData as {
      authorizationEndpoint: string;
      codeVerifier: string;
      finalRedirectUrl: string;
    };
  }

  async generateAuthorizationUrl({
    oauthMetadata,
    scopes,
    toolboxCallbackUrl,
    finalRedirectUrl,
  }: {
    oauthMetadata: OAuthMetadata;
    scopes?: string[];
    toolboxCallbackUrl: string;
    finalRedirectUrl: string;
  }): Promise<{ authorizationUrl: string } | { error: string }> {
    // Get Client data
    const registrationData = await this.getRegistrationData({
      oauthMetadata,
      toolboxCallbackUrl,
    });

    if ("error" in registrationData) {
      return {
        error: `Failed to get registration data: ${registrationData.error}`,
      };
    }

    const state = randomUUID();
    const stateStorageKey = this.getStateStorageKey(state);

    try {
      const { authorizationUrl, codeVerifier } = await startAuthorization(
        oauthMetadata.authorization_endpoint,
        {
          metadata: oauthMetadata,
          clientInformation: registrationData,
          redirectUrl: toolboxCallbackUrl,
          scope: scopes?.join(" "),
          state,
        }
      );

      console.log("Generated with", toolboxCallbackUrl);

      await this.store.write(stateStorageKey, {
        authorizationEndpoint: oauthMetadata.authorization_endpoint,
        codeVerifier,
        finalRedirectUrl,
      });

      return { authorizationUrl: authorizationUrl.href };
    } catch (error) {
      console.error("Failed to generate authorization URL:", error);
      return {
        error:
          error instanceof Error
            ? error.message
            : "Failed to generate authorization URL",
      };
    }
  }

  // Clerk won't need this
  async handleAuthorizationCallback(
    request: Request,
    toolboxCallbackUrl: string
  ): Promise<{ finalRedirectUrl: string }> {
    const url = new URL(request.url);
    const state = url.searchParams.get("state");
    if (!state) {
      throw new Error("No state found");
    }

    const stateData = await this.getStateData(state);
    if (!stateData) {
      throw new Error("No state data found");
    }

    const authorizationCode = url.searchParams.get("code");
    if (!authorizationCode) {
      throw new Error("No authorization code found");
    }

    const registrationKey = await this.getRegistrationStorageKey(
      stateData.authorizationEndpoint
    );
    const registrationData = (await this.store.read(
      registrationKey
    )) as OAuthClientInformationFull;

    const oauthMetadata = await discoverOAuthMetadata(
      stateData.authorizationEndpoint
    );

    console.log("OAUTH METADATA LOAD", oauthMetadata);
    console.log("REGISTRATION DATA LOAD", registrationData);

    const tokens = await exchangeAuthorization(
      stateData.authorizationEndpoint,
      {
        metadata: oauthMetadata,
        clientInformation: registrationData,
        authorizationCode,
        codeVerifier: stateData.codeVerifier,
        redirectUri: toolboxCallbackUrl,
      }
    );

    await this.store.write(this.getStateStorageKey(state), null);
    await this.writeTokens(stateData.authorizationEndpoint, tokens);

    return { finalRedirectUrl: stateData.finalRedirectUrl };
  }

  async hasAccessToken({
    authorizationServerUrl,
  }: {
    authorizationServerUrl: string;
  }): Promise<boolean> {
    return !!(await this.getAccessToken({ authorizationServerUrl }));
  }

  async getAccessToken({
    authorizationServerUrl,
  }: {
    authorizationServerUrl: string;
  }): Promise<string | null> {
    const tokens = await this.getTokens(authorizationServerUrl);
    return tokens ? tokens.access_token : null;
  }

  async isRegistered({
    authorizationServerUrl,
  }: {
    authorizationServerUrl: string;
  }): Promise<boolean> {
    const storageKey = this.getRegistrationStorageKey(authorizationServerUrl);
    const registration = await this.store.read(storageKey);
    return !!registration;
  }
}
