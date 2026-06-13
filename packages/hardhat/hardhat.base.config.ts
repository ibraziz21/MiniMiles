import '@nomicfoundation/hardhat-toolbox';
import '@openzeppelin/hardhat-upgrades';
import { config as dotEnvConfig } from 'dotenv';
import { HardhatUserConfig } from 'hardhat/config';

dotEnvConfig();

const PK = process.env.PRIVATE_KEY ?? '0x0000000000000000000000000000000000000000000000000000000000000001';

const config: HardhatUserConfig = {
  paths: {
    sources: './contracts/base',
    cache:   './cache-base',
    artifacts: './artifacts-base',
  },
  networks: {
    base: {
      url:      process.env.BASE_RPC_URL ?? 'https://mainnet.base.org',
      accounts: [PK],
      chainId:  8453,
    },
    baseSepolia: {
      url:      process.env.BASE_SEPOLIA_RPC_URL ?? 'https://sepolia.base.org',
      accounts: [PK],
      chainId:  84532,
    },
  },
  etherscan: {
    apiKey: {
      base:        process.env.BASESCAN_API_KEY ?? '',
      baseSepolia: process.env.BASESCAN_API_KEY ?? '',
    },
    customChains: [
      {
        network: 'base',
        chainId: 8453,
        urls: {
          apiURL:     'https://api.basescan.org/api',
          browserURL: 'https://basescan.org',
        },
      },
      {
        network: 'baseSepolia',
        chainId: 84532,
        urls: {
          apiURL:     'https://api-sepolia.basescan.org/api',
          browserURL: 'https://sepolia.basescan.org',
        },
      },
    ],
  },
  sourcify: { enabled: false },
  solidity: {
    version: '0.8.24',
    settings: { optimizer: { enabled: true, runs: 200 }, viaIR: true },
  },
};
export default config;
