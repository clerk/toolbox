"use client";

import { useState } from "react";
import { useToolbox } from "toolbox/nextjs";
export default function Home() {
  const { toolbox, isLoaded } = useToolbox();
  const [toolResponse, setToolResponse] = useState(null);
  const [toolError, setToolError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  console.log("Toolbox", toolbox);

  const handleAdd = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const formData = new FormData(event.currentTarget);
    await toolbox.addServer(formData);
  };

  const handleToolCall = async () => {
    fetch("/call_tool", {
      method: "POST",
      body: JSON.stringify({}),
    })
      .then((res) => res.json())
      .then((res) => {
        if (res.error) {
          setToolError(`Tool call failed: ${res.error}`);
        }
        setToolResponse(res.content);
      })
      .catch((error) => {
        console.error("Tool call failed:", error);
        setToolError("Tool call failed");
      });
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col p-4">
      {error && (
        <div className="max-w-6xl mx-auto mt-4">
          <div className="bg-red-50 border border-red-200 rounded-md p-4">
            <div className="flex">
              <div className="flex-shrink-0">
                <svg
                  className="h-5 w-5 text-red-400"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                >
                  <path
                    fillRule="evenodd"
                    d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
                    clipRule="evenodd"
                  />
                </svg>
              </div>
              <div className="ml-3">
                <p className="text-sm text-red-800">{error}</p>
              </div>
              <div className="ml-auto pl-3">
                <div className="-mx-1.5 -my-1.5">
                  <button
                    onClick={() => setError(null)}
                    className="inline-flex bg-red-50 rounded-md p-1.5 text-red-500 hover:bg-red-100 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-red-50 focus:ring-red-600"
                  >
                    <span className="sr-only">Dismiss</span>
                    <svg
                      className="h-5 w-5"
                      viewBox="0 0 20 20"
                      fill="currentColor"
                    >
                      <path
                        fillRule="evenodd"
                        d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                        clipRule="evenodd"
                      />
                    </svg>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
      <div className="flex flex-col md:flex-row w-full gap-6 max-w-6xl mx-auto mt-20">
        <div className="flex-1">
          <div className="bg-white rounded-lg shadow-md p-6 h-full flex flex-col justify-start">
            <h2 className="text-2xl font-bold text-gray-800 mb-6 text-center">
              MCP Servers (new)
            </h2>
            {!isLoaded ? (
              <div>Loading</div>
            ) : (
              <>
                {toolbox.servers.map((server) => (
                  <div
                    key={server.url}
                    className="border border-gray-200 rounded-lg p-4 mb-4"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex-1">
                        <h3 className="text-lg font-medium text-gray-900 truncate">
                          {server.url}
                        </h3>
                        <p className="text-sm text-gray-500 mt-1">
                          {server.authorization?.status === "connected"
                            ? "Connected"
                            : server.authorization?.status ===
                              "requires_connection"
                            ? "Needs connection"
                            : server.authorization?.status ===
                              "requires_registration"
                            ? "Requires client registration"
                            : server.authorization?.status ===
                              "discovery_failed"
                            ? "Discovery failed"
                            : "Not connected"}
                        </p>
                        {server.authorization?.status === "discovery_failed" &&
                          (server.authorization
                            ?.protectedResourceMetadataError ||
                            server.authorization?.authorizationServerError) && (
                            <p className="text-sm text-red-600 mt-1">
                              Error:{" "}
                              {server.authorization
                                .protectedResourceMetadataError ||
                                server.authorization.authorizationServerError}
                            </p>
                          )}
                        {server.authorization?.registrationError && (
                          <p className="text-sm text-red-600 mt-1">
                            Registration Error:{" "}
                            {server.authorization.registrationError}
                          </p>
                        )}
                      </div>
                      <div className="flex items-center space-x-2">
                        {server.authorization?.status === "connected" ? (
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                            Connected
                          </span>
                        ) : (
                          <button
                            onClick={async () => {
                              if (
                                server.authorization?.status ===
                                "discovery_failed"
                              ) {
                                server.retryDiscovery();
                              } else if (
                                server.authorization?.status ===
                                "requires_registration"
                              ) {
                                server.retryDiscovery();
                              } else {
                                try {
                                  const result =
                                    await server.generateAuthorizationUrl();
                                  if ("authorizationUrl" in result) {
                                    window.location.href =
                                      result.authorizationUrl;
                                  } else {
                                    setError(
                                      `Failed to generate authorization URL: ${result.error}`
                                    );
                                  }
                                } catch (error) {
                                  setError(
                                    `Failed to generate authorization URL: ${
                                      (error as Error).message
                                    }`
                                  );
                                }
                              }
                            }}
                            className="inline-flex items-center px-3 py-1.5 border border-transparent text-xs font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                          >
                            {server.authorization?.status === "discovery_failed"
                              ? "Retry discovery"
                              : server.authorization?.status ===
                                "requires_registration"
                              ? "Retry"
                              : "Connect"}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
                <form className="space-y-4" onSubmit={handleAdd}>
                  <div className="space-y-2">
                    <label
                      className="block text-sm font-medium text-gray-700"
                      htmlFor="url"
                    >
                      MCP Server URL
                    </label>
                    <input
                      id="url"
                      name="url"
                      type="text"
                      defaultValue="http://localhost:3001/mcp"
                      required
                      className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    />
                  </div>
                  <button
                    type="submit"
                    className={`w-full bg-blue-600 hover:bg-blue-700 text-white py-2 px-4 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-colors mt-6`}
                  >
                    "Add Integration"
                  </button>
                </form>
              </>
            )}
          </div>
        </div>

        {/* Right Section - Tool Call Button */}
        <div className="flex-1">
          <div className="bg-white rounded-lg shadow-md p-6 h-full flex flex-col items-center justify-center">
            <h2 className="text-2xl font-bold text-gray-800 mb-6 text-center">
              Tool Call
            </h2>
            <p className="text-gray-600 mb-8 text-center">
              Click the button below to trigger an MCP tool call that rolls a
              dice.
            </p>
            <button
              className="bg-emerald-600 text-white py-3 px-6 rounded-md hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 transition-colors font-medium text-lg"
              onClick={handleToolCall}
            >
              Trigger Tool Call
            </button>
            {toolError && (
              <div className="text-red-500 text-sm mt-5">{toolError}</div>
            )}
            {toolResponse ? (
              <div className="mt-6 p-4 bg-gray-50 rounded-lg border border-gray-200 max-h-[300px] overflow-auto w-full">
                <pre className="text-sm whitespace-pre-wrap break-words font-mono">
                  <code className="text-gray-800">
                    {JSON.stringify(toolResponse, null, 2)}
                  </code>
                </pre>
              </div>
            ) : (
              ""
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
