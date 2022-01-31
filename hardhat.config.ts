import "@nomiclabs/hardhat-waffle";
import "@typechain/hardhat";
import "hardhat-gas-reporter";
import "solidity-coverage";

import "./tasks/accounts";
import "./tasks/deploy";

import { resolve } from "path";

import { config as dotenvConfig } from "dotenv";
import { HardhatUserConfig } from "hardhat/config";
import { NetworkUserConfig } from "hardhat/types";

import "@nomiclabs/hardhat-etherscan";
import "hardhat-gas-reporter";
import "hardhat-interface-generator";

dotenvConfig({ path: resolve(__dirname, "./.env") });

const chainIds = {
  goerli: 5,
  hardhat: 31337,
  kovan: 42,
  mainnet: 1,
  rinkeby: 4,
  ropsten: 3,
  localhost: 1337,
  fuji: 43113,
  avalanche: 43114,
};

// Ensure that we have all the environment variables we need.
const mnemonic: string | undefined = process.env.MNEMONIC;
if (!mnemonic) {
  throw new Error("Please set your MNEMONIC in a .env file");
}

const infuraApiKey: string | undefined = process.env.INFURA_API_KEY;
if (!infuraApiKey) {
  throw new Error("Please set your INFURA_API_KEY in a .env file");
}

function getChainConfig(network: keyof typeof chainIds): NetworkUserConfig {
  let url;
  if (network == "localhost") {
    url = "http://localhost:7545";
  } else if (network == "fuji") {
    url = "https://api.avax-test.network/ext/bc/C/rpc";
  } else if (network == "avalanche") {
    url = "https://api.avax.network/ext/bc/C/rpc";
  } else {
    url = "https://" + network + ".infura.io/v3/" + infuraApiKey;
    url = "https://eth-rinkeby.alchemyapi.io/v2/cSqVM_gxvwfoPiTN2hgH1s2l9ay7hg-M";
  }

  return {
    accounts: {
      count: 10,
      mnemonic,
      path: "m/44'/60'/0'/0",
    },
    chainId: chainIds[network],
    url,
  };
}

const config: HardhatUserConfig = {
  defaultNetwork: "hardhat",
  gasReporter: {
    currency: "USD",
    enabled: process.env.REPORT_GAS ? true : false,
    excludeContracts: [],
    src: "./contracts",
    coinmarketcap: process.env.API_KEY_COINMARKETCAP,
    gasPrice: 150,
  },
  networks: {
    hardhat: {
      accounts: {
        mnemonic,
      },
      forking: {
        url: "https://eth-kovan.alchemyapi.io/v2/54bDiNOcguTQLWltv15reakFyi3uwiJj",
        blockNumber: 29392106,
      },
      chainId: chainIds.hardhat,
    },
    goerli: getChainConfig("goerli"),
    kovan: getChainConfig("kovan"),
    rinkeby: getChainConfig("rinkeby"),
    mainnet: getChainConfig("mainnet"),
    ropsten: getChainConfig("ropsten"),
    localhost: getChainConfig("localhost"),
    fuji: getChainConfig("fuji"),
    avalanche: getChainConfig("avalanche"),
  },
  etherscan: {
    // Your API key for Etherscan
    // Obtain one at https://etherscan.io/
    apiKey: process.env.ETHERSCAN_API_KEY,
  },
  paths: {
    artifacts: "./artifacts",
    cache: "./cache",
    sources: "./contracts",
    tests: "./test",
  },
  mocha: {
    timeout: 40000
  },
  solidity: {
    version: "0.8.9",
    settings: {
      metadata: {
        // Not including the metadata hash
        // https://github.com/paulrberg/solidity-template/issues/31
        bytecodeHash: "none",
      },
      // Disable the optimizer when debugging
      // https://hardhat.org/hardhat-network/#solidity-optimizer-support
      optimizer: {
        enabled: true,
        runs: 800,
      },
    },
  },
  typechain: {
    outDir: "typechain",
    target: "ethers-v5",
  },
};

export default config;
