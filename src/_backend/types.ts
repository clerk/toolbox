import { OAuthMetadata } from "@modelcontextprotocol/sdk/shared/auth.js";
import { AuthProviderBase } from "./auth/provider-base.js";
import type { OAuthClientInformationFull } from "@modelcontextprotocol/sdk/shared/auth.js";

type JsonSerializable =
  | null
  | undefined
  | boolean
  | number
  | string
  | JsonSerializable[]
  | { [key: string]: JsonSerializable }
  | OAuthMetadata;

export interface DataStore {
  write: (key: string, value: JsonSerializable) => Promise<void>;
  read: (key: string) => Promise<JsonSerializable>;
}

export interface AuthProvider extends AuthProviderBase {
  userId: string;
  generateAuthorizationUrl: ({
    oauthMetadata,
    scopes,
    toolboxCallbackUrl,
    finalRedirectUrl,
  }: {
    oauthMetadata: OAuthMetadata;
    scopes?: string[];
    toolboxCallbackUrl: string;
    finalRedirectUrl: string;
  }) => Promise<{ authorizationUrl: string } | { error: string }>;
  getAccessToken: ({
    authorizationServerUrl,
  }: {
    authorizationServerUrl: string;
  }) => Promise<string | null>;
  hasAccessToken: ({
    authorizationServerUrl,
  }: {
    authorizationServerUrl: string;
  }) => Promise<boolean>;
  isRegistered: ({
    authorizationServerUrl,
  }: {
    authorizationServerUrl: string;
  }) => Promise<boolean>;
  registerDynamically: ({
    oauthMetadata,
    toolboxCallbackUrl,
  }: {
    oauthMetadata: OAuthMetadata;
    toolboxCallbackUrl: string;
  }) => Promise<OAuthClientInformationFull | { error: string }>;
  handleAuthorizationCallback: (
    request: Request,
    toolboxCallbackUrl: string
  ) => Promise<{ finalRedirectUrl: string }>;
}
