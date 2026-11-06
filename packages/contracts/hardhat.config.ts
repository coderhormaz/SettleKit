import { defineConfig } from "hardhat/config";
import hardhatToolboxViem from "@nomicfoundation/hardhat-toolbox-viem";

export default defineConfig({
  plugins: [hardhatToolboxViem],
  solidity: {
    version: "0.8.38",
    settings: { evmVersion: "prague", optimizer: { enabled: true, runs: 200 } },
  },
  networks: {
    // Explicitly local test-only EDR instance. This never connects to Whitechain.
    localIntegration: {
      type: "edr-simulated",
      chainType: "l1",
      chainId: 1874,
    },
    whitechainSepolia: {
      type: "http",
      chainType: "op",
      chainId: 1874,
      url: process.env.WHITECHAIN_RPC_URL || "https://rpc.testnet.whitechain.io",
      accounts: [],
    },
  },
  chainDescriptors: {
    1874: {
      name: "Whitechain Sepolia",
      chainType: "op",
      blockExplorers: {
        blockscout: {
          name: "Blockscout",
          url: "https://explorer.testnet.whitechain.io",
          apiUrl: "https://explorer.testnet.whitechain.io/api",
        },
      },
    },
  },
});
