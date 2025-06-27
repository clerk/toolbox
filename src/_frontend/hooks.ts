"use client";

import { useState, useEffect } from "react";

type ServerData = {
  id: string;
  url: string;
  authorization: {
    status:
      | "not_required"
      | "discovery_failed"
      | "requires_registration"
      | "requires_connection"
      | "connected";
    protectedResourceMetadata: any;
    protectedResourceMetadataError: string | null;
    authorizationServerUrl: string;
    authorizationServerMetadata: any;
    authorizationServerError: string | null;
    unauthedWwwAuthenticate: string | null;
    unauthedStatusCode: number | null;
    registrationError: string | null;
  };
  hasAccessToken?: boolean;
};

const toolboxGet = async (url: string, action: string) => {
  const fetchUrl = new URL(url, window.location.origin);
  fetchUrl.searchParams.set("action", action);
  console.log("Fetching", fetchUrl);
  const res = await fetch(fetchUrl);
  return await res.json();
};

const toolboxPost = async (url: string, action: string, data: FormData) => {
  const fetchUrl = new URL(url, window.location.origin);
  fetchUrl.searchParams.set("action", action);
  const res = await fetch(fetchUrl, {
    method: "POST",
    body: data,
  });
  return await res.json();
};

export const useToolbox = (toolboxUrl?: string) => {
  const url = toolboxUrl || "/toolbox";
  // toolbox.addServer
  // toolbox.addServerStatus
  // toolbox.servers
  // toolbox.selection
  // const [selection, setSelection] = useState();

  const [isLoaded, setIsLoaded] = useState(false);
  const [servers, setServers] = useState<
    (ServerData & {
      retryDiscovery: () => Promise<void>;
      generateAuthorizationUrl: (
        scopes?: string[],
        finalRedirectUrl?: string
      ) => Promise<{ authorizationUrl: string } | { error: string }>;
    })[]
  >([]);

  const retryDiscovery = async (serverId: string) => {
    const formData = new FormData();
    formData.append("serverId", serverId);
    const res = await toolboxPost(url, "retry_discovery", formData);
    setServers(addMethodsToServers(res.servers));
  };

  const generateAuthorizationUrl = async (
    serverId: string,
    scopes?: string[],
    finalRedirectUrl?: string
  ) => {
    const formData = new FormData();
    formData.append("serverId", serverId);
    if (scopes) {
      formData.append("scopes", scopes.join(" "));
    }
    // Default to current page URL if no finalRedirectUrl is provided
    const redirectUrl = finalRedirectUrl || window.location.href;
    formData.append("finalRedirectUrl", redirectUrl);
    const res = await toolboxPost(url, "generate_authorization_url", formData);
    return res.authorizationUrl
      ? { authorizationUrl: res.authorizationUrl }
      : { error: res.error };
  };

  const addMethodsToServers = (servers: ServerData[]) => {
    return servers.map((server: ServerData) => ({
      ...server,
      retryDiscovery: () => retryDiscovery(server.id),
      generateAuthorizationUrl: (
        scopes?: string[],
        finalRedirectUrl?: string
      ) => generateAuthorizationUrl(server.id, scopes, finalRedirectUrl),
    }));
  };

  useEffect(() => {
    async function fetchToolbox() {
      const res = await toolboxGet(url, "read_toolbox");
      setServers(addMethodsToServers(res.servers));
      setIsLoaded(true);
    }
    fetchToolbox();
  }, [url]);

  const toolbox = {
    servers: servers,
    addServer: async (data: FormData) => {
      const res = await toolboxPost(url, "add_server", data);
      setServers(addMethodsToServers(res.servers));
    },
  };

  return { toolbox, isLoaded };
};
