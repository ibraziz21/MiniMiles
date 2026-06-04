import '@nomicfoundation/hardhat-toolbox';
import '@nomicfoundation/hardhat-verify';
import { config as dotEnvConfig } from 'dotenv';
import { HardhatUserConfig } from 'hardhat/config';

dotEnvConfig();

const config: HardhatUserConfig = {
  networks: {
    celo: {
      accounts: [process.env.PRIVATE_KEY ?? '0x0'],
      url: process.env.CELO_RPC_URL ?? 'https://forno.celo.org',
    },
  },
  etherscan: {
    apiKey: process.env.CELOSCAN_API_KEY ?? '',
    customChains: [
      {
        chainId: 42_220,
        network: 'celo',
        urls: {
          apiURL: 'https://api.celoscan.io/api',
          browserURL: 'https://celoscan.io/',
        },
      },
    ],
  },
  sourcify: {
    enabled: false,
  },
  solidity: {
    version: '0.8.24',
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  },
  paths: {
    sources: './contracts/skill-games',
    artifacts: './artifacts-skill-games',
    cache: './cache-skill-games',
  },
};

export default config;
