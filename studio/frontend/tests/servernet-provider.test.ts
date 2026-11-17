// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 ServerNet contributors

import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer, type ViteDevServer } from "vite";

let vite: ViteDevServer;
before(async () => {
  vite = await createServer({ appType: "custom", server: { middlewareMode: true } });
});
after(async () => { await vite.close(); });

test("ServerNet appears first in the connection gallery when supplied by the backend", async () => {
  const { buildConnectionGallery } = await vite.ssrLoadModule("/src/features/chat/connection-gallery.tsx");
  const registry = [
    { provider_type: "openai", display_name: "OpenAI" },
    { provider_type: "servernet", display_name: "ServerNet AI Gateway" },
  ];
  const groups = buildConnectionGallery(registry);
  assert.equal(groups[0].items[0].providerType, "servernet");
  assert.equal(groups[0].items[0].name, "ServerNet AI Gateway");
  assert.equal(groups.flatMap((g: { items: { providerType: string }[] }) => g.items)
    .filter((p: { providerType: string }) => p.providerType === "servernet").length, 1);
  const withoutBackendEntry = buildConnectionGallery(registry.slice(0, 1));
  assert.equal(withoutBackendEntry.flatMap((g: { items: { providerType: string }[] }) => g.items)
    .some((p: { providerType: string }) => p.providerType === "servernet"), false);
});

test("ServerNet uses the remote catalog without being rewritten to a custom provider", async () => {
  const providers = await vite.ssrLoadModule("/src/features/chat/external-providers.ts");
  assert.equal(providers.supportsRemoteModelCatalog("servernet"), true);
  assert.equal(providers.isCustomProviderType("servernet"), false);
  assert.equal(providers.toExternalBackendProviderType("servernet"), "servernet");
});
