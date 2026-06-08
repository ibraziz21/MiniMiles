// Minimal config for compiling non-LayerZero contracts (skips claw/ClawVRFBridge).
// Usage: npx hardhat compile --config hardhat.minimal.config.ts
import '@nomicfoundation/hardhat-toolbox';
import { config as dotEnvConfig } from 'dotenv';
import { HardhatUserConfig } from 'hardhat/config';

dotEnvConfig();

const config: HardhatUserConfig = {
  paths: {
    sources: "./contracts-new",
    cache:   "./cache-minimal",
    artifacts: "./artifacts-minimal",
  },
  networks: {
    celo: {
      accounts: [process.env.PRIVATE_KEY ?? '0x0'],
      url: 'https://forno.celo.org',
    },
  },
  solidity: {
    compilers: [
      {
        version: '0.8.24',
        settings: { optimizer: { enabled: true, runs: 200 } },
      },
      {
        version: '0.8.20',
        settings: { optimizer: { enabled: true, runs: 200 } },
      },
    ],
  },
};

export default config;
