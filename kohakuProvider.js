// Thin adapter routing privacy-sensitive RPC calls (proof-related reads,
// relayer-bound submissions) through Kohaku's provider abstraction instead
// of the wallet's default injected RPC endpoint, so those calls don't
// inherit the connected wallet's default endpoint/fingerprint.
//
// NOTE: @kohaku-eth/provider is an early-stage package; its exported API
// may not match this shape exactly. This file exists so the integration
// surface is isolated to one place — swap the import/class name here if
// the upstream package's API differs from what's assumed below.

import { ethers } from "ethers";

let cachedProvider = null;

export async function getPrivacyProvider(rpcUrl) {
  if (cachedProvider) return cachedProvider;

  try {
    const { KohakuProvider } = await import("@kohaku-eth/provider");
    cachedProvider = new KohakuProvider({ rpcUrl });
  } catch (err) {
    console.warn(
      "[kohakuProvider] @kohaku-eth/provider unavailable, falling back to ethers.JsonRpcProvider:",
      err.message
    );
    cachedProvider = new ethers.JsonRpcProvider(rpcUrl);
  }

  return cachedProvider;
}
