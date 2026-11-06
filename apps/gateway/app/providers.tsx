"use client";

import { useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createConfig, http, WagmiProvider } from "wagmi";
import { injected } from "wagmi/connectors";
import { defineChain } from "viem";

export const whitechain = defineChain({
  id: 1874,
  name: "Whitechain Sepolia",
  nativeCurrency: { name: "WhiteBIT Coin", symbol: "WBT", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.testnet.whitechain.io"] } },
  blockExplorers: { default: { name: "Whitechain Explorer", url: "https://explorer.testnet.whitechain.io" } },
  testnet: true,
});

const config = createConfig({
  chains: [whitechain],
  connectors: [injected()],
  transports: { [whitechain.id]: http() },
  ssr: true,
});

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: true }, mutations: { retry: false } },
  }));
  return <WagmiProvider config={config}><QueryClientProvider client={queryClient}>{children}</QueryClientProvider></WagmiProvider>;
}
