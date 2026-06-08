/**
 * Isolated Hardhat config for Farkle PvP contract suite.
 * Scopes compilation to contracts/farkle/ only so the missing
 * @layerzerolabs dep in contracts/claw/ does not block the build.
 *
 * Usage:
 *   npx hardhat compile  --config hardhat.farkle.config.ts
 *   npx hardhat run scripts/deploy-farkle.ts --config hardhat.farkle.config.ts --network celo
 */
import '@nomicfoundation/hardhat-toolbox';
import '@nomicfoundation/hardhat-verify';
import '@openzeppelin/hardhat-upgrades';
import { config as dotEnvConfig } from 'dotenv';
import { HardhatUserConfig } from 'hardhat/config';

dotEnvConfig();

const config: HardhatUserConfig = {
  paths: {
    sources: './contracts/farkle',
    artifacts: './artifacts-farkle',
    cache: './cache-farkle',
  },
  networks: {
    celoSepolia: {
      accounts: [process.env.PRIVATE_KEY ?? '0x0'],
      url: 'https://forno.celo-sepolia.celo-testnet.org',
    },
    celo: {
      accounts: [process.env.PRIVATE_KEY ?? '0x0'],
      url: 'https://forno.celo.org',
    },
  },
  etherscan: {
    apiKey: process.env.CELOSCAN_API_KEY ?? '',
    customChains: [
      {
        chainId: 42_220,
        network: 'celo',
        urls: {
          apiURL:     'https://api.celoscan.io/api',
          browserURL: 'https://celoscan.io/',
        },
      },
      {
        chainId: 11142220,
        network: 'celoSepolia',
        urls: {
          apiURL:     'https://api-alfajores.celoscan.io/api',
          browserURL: 'https://alfajores.celoscan.io',
        },
      },
    ],
  },
  sourcify: { enabled: false },
  solidity: {
    version: '0.8.24',
    settings: {
      optimizer: { enabled: true, runs: 200 },
    },
  },
};

export default config;
