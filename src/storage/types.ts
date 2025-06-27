import { OAuthMetadata } from "@modelcontextprotocol/sdk/shared/auth.js";

export type JsonSerializable =
  | null
  | undefined
  | boolean
  | number
  | string
  | JsonSerializable[]
  | { [key: string]: JsonSerializable }
  | OAuthMetadata;
