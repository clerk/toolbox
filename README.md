> [!NOTE]
> Toolbox is still in development. There will not be semver guarantees until 1.0.0.

# Toolbox

Toolbox is a production-grade library for connecting to MCP servers that require authentication.

## What makes Toolbox production-grade?

Toolbox was built with an emphasis on security and practical credential management. There are two critical differences compared to other utilities for leveraging MCP servers:

### Access and refresh tokens stay on the server

Access and refresh tokens for users are never sent to the frontend, which ensures they cannot be compromised in an XSS attack.

### Only one OAuth Client is registered per OAuth Server

When using MCP, the service provider should manage a single OAuth Server, while your agent should operate one OAuth Client.

This is preferred over implementations that dynamically register a new OAuth Client for each user, since it allows providers to understand which activity is coming from your agent.

## Installation

```bash
npm install toolbox
```

## Quick Start

### 1. Mount the handler

Create a Next.js API route at `app/toolbox/route.ts`:

```typescript
import { Toolbox } from "toolbox/nextjs/server";
import { SelfStorageAuthProvider } from "toolbox/nextjs/auth/self-storage";
import fsStore from "toolbox/storage/fs";

const toolbox = new Toolbox({
  auth: new SelfStorageAuthProvider({
    store: fsStore,
    userId: "u_12345", // Replace with your user ID
    oauthClientName: "My App",
    oauthClientUri: "https://myapp.com",
    discoveryOptions: {
      resourceVsProtectedResourceMetadata: "any",
    },
  }),
  store: fsStore,
});

export const { GET, POST } = toolbox.handlers();
```

### 2. Manage connections with `useToolbox()`

Use the React hook in your components:

```typescript
import { useToolbox } from "toolbox/nextjs";

export default function MyComponent() {
  const { toolbox, isLoaded } = useToolbox();

  const handleAddServer = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    await toolbox.addServer(formData);
  };

  if (!isLoaded) return <div>Loading...</div>;

  return (
    <div>
      {toolbox.servers.map((server) => (
        <div key={server.id}>
          <h3>{server.url}</h3>
          <p>Status: {server.authorization.status}</p>
          {server.authorization.status === "requires_connection" && (
            <button
              onClick={async () => {
                const result = await server.generateAuthorizationUrl();
                if ("authorizationUrl" in result) {
                  window.location.href = result.authorizationUrl;
                }
              }}
            >
              Connect
            </button>
          )}
        </div>
      ))}

      <form onSubmit={handleAddServer}>
        <input name="url" placeholder="MCP Server URL" required />
        <button type="submit">Add Server</button>
      </form>
    </div>
  );
}
```

### 3. Pass the MCP context to your AI solution

Coming soon.

## Configuration Options

### Auth Providers

Toolbox supports multiple authentication providers:

- **SelfStorageAuthProvider**: Stores OAuth credentials and tokens in your configured data store
- **ClerkAuthProvider**: Uses Clerk to manage credentials and token (coming soon)

### Data Stores

Choose from multiple storage backends:

- **File System**: `toolbox/storage/fs` (default, good for development)
- **Redis**: `toolbox/storage/redis`
- **PostgreSQL**: `toolbox/storage/postgres`
- **SQLite**: `toolbox/storage/sqlite`

### Server Status

MCP servers can have the following authorization statuses:

- `not_required`: Server doesn't require authentication
- `discovery_failed`: Failed to discover OAuth configuration
- `requires_registration`: Client registration needed
- `requires_connection`: User needs to authorize
- `connected`: Fully authenticated and ready to use

## API Reference

### useToolbox(toolboxUrl?: string)

Returns an object with:

- `toolbox`: Object containing servers and methods
- `isLoaded`: Boolean indicating if data has loaded

### toolbox.servers

Array of MCP server objects with:

- `id`: Unique server identifier
- `url`: Server endpoint URL
- `authorization`: OAuth configuration and status
- `hasAccessToken`: Whether user has authorized access
- `retryDiscovery()`: Retry OAuth discovery
- `generateAuthorizationUrl()`: Generate OAuth authorization URL

### toolbox.addServer(formData: FormData)

Add a new MCP server. FormData should contain:

- `url`: The MCP server endpoint URL

## Examples

See the [nextjs-selfstorage example](./examples/nextjs-selfstorage) for a complete working implementation.

The output of toolbox is an array of connected MCP servers and the OAuth access tokens necessary to communicate with them.

We'll provide helpers to pass that data to your preferred AI solution.
