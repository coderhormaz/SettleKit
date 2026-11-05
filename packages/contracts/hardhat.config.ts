import { defineConfig } from "hardhat/config";
import hardhatToolboxViem from "@nomicfoundation/hardhat-toolbox-viem";

export default defineConfig({
  plugins: [hardhatToolboxViem],
  solidity: {
    version: "0.8.38",
    settings: { evmVersion: "prague", optimizer: { enabled: true, runs: 200 } },
  },
});
