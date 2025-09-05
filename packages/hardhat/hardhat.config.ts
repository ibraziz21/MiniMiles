import '@nomicfoundation/hardhat-toolbox';
import '@nomicfoundation/hardhat-verify';
import { config as dotEnvConfig } from 'dotenv';
import { HardhatUserConfig } from 'hardhat/config';

dotEnvConfig();

const config: HardhatUserConfig = {
  networks: {
    alfajores: {
      accounts: [process.env.PRIVATE_KEY ?? '0x0'],
      url: 'https://alfajores-forno.celo-testnet.org',
    },
    celo: {
      accounts: [process.env.PRIVATE_KEY ?? '0x0'],
      url: 'https://forno.celo.org',
    },
    sepolia:{

    accounts: [process.env.PRIVATE_KEY ?? '0x0'],
    url: 'https://eth-sepolia.g.alchemy.com/v2/XucMy0SW663XxpBZLQtKH2kvbvydqysK'
    }
    
  },
  etherscan: {
    apiKey: {
      alfajores: process.env.CELOSCAN_API_KEY ?? '',
      celo: process.env.CELOSCAN_API_KEY ?? '',
      sepolia: 'GG98NBUZX46RSPK26MDUA76KSVWIHHDPHI'
    },
    customChains: [
      {
        chainId: 44_787,
        network: 'alfajores',
        urls: {
          apiURL: 'https://api-alfajores.celoscan.io/api',
          browserURL: 'https://alfajores.celoscan.io',
        },
      },
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
  solidity:{
    version: '0.8.24',
  settings: {
    // These three are the big wins for code size
    optimizer: { enabled: true, runs: 200 }, // try 200, 1, or 800 depending on size vs. runtime gas
    viaIR: true,                              // IR pipeline shrinks bytecode a lot
    metadata: { bytecodeHash: "none" },       // smaller deploy bytecode (runtime size is the EIP-170 limit)
    // evmVersion: "paris", // uncomment if you want to pin EVM version
  },
}

};

export default config;
