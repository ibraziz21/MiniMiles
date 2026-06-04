import '@nomicfoundation/hardhat-toolbox';
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
  solidity: '0.8.24',
  paths: {
    sources: './contracts/no-compile',
    artifacts: './artifacts-claw-batch',
    cache: './cache-claw-batch',
  },
};

export default config;
