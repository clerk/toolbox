import { Toolbox } from "toolbox/nextjs/server";
import { SelfStorageAuthProvider } from "toolbox/nextjs/auth/self-storage";
import fsStore from "toolbox/storage/fs";

// import { ClerkCredentialManager } from "toolbox/nextjs/clerk";

const toolbox = new Toolbox({
  // contextId: "custom_context_id", // Optional: defaults to auth.userId if not provided
  auth: new SelfStorageAuthProvider({
    store: fsStore,
    userId: "u_12345",
    oauthClientName: "My Self Storage App",
    oauthClientUri: "https://myapp.com",
    discoveryOptions: {
      resourceVsProtectedResourceMetadata: "any",
      //   resourceVsAuthorizationServer: "any",
    },
  }),
  store: fsStore,
});

export const { GET, POST } = toolbox.handlers();
