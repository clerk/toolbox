import { OAuthMetadata } from "@modelcontextprotocol/sdk/shared/auth.js";

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
