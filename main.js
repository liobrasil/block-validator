const { ethers } = require("ethers");
const WebSocket = require("ws");
const dotenv = require("dotenv");
const fs = require('fs');

dotenv.config();

// Same ABI and config
const CONTRACT_ABI = [
  {
    inputs: [],
    name: "getValidators",
    outputs: [{ internalType: "address[]", name: "", type: "address[]" }],
    stateMutability: "view",
    type: "function",
  },
];

const config = {
  wsUrl: process.env.WSS,
  rpcUrl: process.env.HTTP,
  contractAddress: "0x0000000000000000000000000000000000001000",
  club48Validators: [
    "0xccb42a9b8d6c46468900527bc741938e78ab4577",
    "0x38944092685a336cb6b9ea58836436709a2adc89",
    "0xf8b99643fafc79d9404de68e48c4d49a3936f787",
    "0x9bb56c2b4dbe5a06d79911c9899b6f817696acfc",
    "0x8a239732871adc8829ea2f47e94087c5fbad47b6"
  ]
};

class BlockValidator {
  constructor() {
    this.provider = new ethers.JsonRpcProvider(config.rpcUrl);
    this.contract = new ethers.Contract(
      config.contractAddress,
      CONTRACT_ABI,
      this.provider
    );
    this.ws = null;
    this.validatorCache = {
      validators: [],
      validatorFromExtraDatas: [],
      lastUpdateBlock: 0,
    };
    this.epochStats = {
      startBlock: 0,
      club48Blocks: 0,
      totalBlocks: 0
    };
    // Add data collection for JSON
    this.epochData = [];
    this.blockData = [];
  }

  async handleNewBlock(blockHeader) {
    const blockNumber = parseInt(blockHeader.number, 16);
    const miner = blockHeader.miner.toLowerCase();

    if (this.epochStats.startBlock === 0) {
      this.epochStats.startBlock = blockNumber - (blockNumber % 200);
    }

    this.epochStats.totalBlocks++;
    if (config.club48Validators.map(addr => addr.toLowerCase()).includes(miner)) {
      this.epochStats.club48Blocks++;
    }

    if (blockNumber % 200 === 0) {
      const percentage = ((this.epochStats.club48Blocks / this.epochStats.totalBlocks) * 100).toFixed(2);
      console.log(`Epoch ${blockNumber-200}-${blockNumber}:`);
      console.log(`Club48 Validation Rate: ${percentage}% (${this.epochStats.club48Blocks}/${this.epochStats.totalBlocks} blocks)`);

      const extraData = blockHeader.extraData;
      await this.updateValidatorList();
      const foundValidators = [];
      const validators = this.validatorCache.validators.map(addr => addr.toLowerCase());

      for (const validator of validators) {
        const validatorWithoutPrefix = validator.slice(2);
        const position = extraData.toLowerCase().indexOf(validatorWithoutPrefix);
        if (position !== -1) {
          foundValidators.push({
            address: validator,
            position: position
          });
        }
      }

      foundValidators.sort((a, b) => a.position - b.position);
      this.validatorCache.validatorFromExtraDatas = foundValidators;
      
      console.log(`Number of validators in extraData: ${foundValidators.length}`);
      console.log("\n---------------------------------");

      // Save epoch data to JSON
      this.epochData.push({
        epochRange: `${blockNumber-200}-${blockNumber}`,
        validationRate: `${percentage}%`,
        club48Blocks: this.epochStats.club48Blocks,
        totalBlocks: this.epochStats.totalBlocks,
        validatorsInExtraData: foundValidators.length,
        validatorOrder: foundValidators.map(v => ({
          address: v.address,
          position: v.position
        })),
        extraData: extraData
      });

      // Write to JSON file
      this.saveToJson();

      this.validatorCache.lastUpdateBlock = blockNumber;
      this.epochStats = {
        startBlock: blockNumber,
        club48Blocks: 0,
        totalBlocks: 0
      };
    } else {
      const extraDataIndex = this.validatorCache.validatorFromExtraDatas.findIndex(
        v => v.address.toLowerCase() === miner
      );
      
      const isClub48 = config.club48Validators.map(addr => addr.toLowerCase()).includes(miner);
      const club48Tag = isClub48 ? "[Club48] " : "";

      if (extraDataIndex !== -1) {
        console.log(`${club48Tag}Block ${blockNumber}: Found in last extraData at position ${extraDataIndex}`);
        
        // Save block data to JSON
        this.blockData.push({
          blockNumber,
          miner,
          extraDataPosition: extraDataIndex,
          isClub48
        });
      }
    }
  }

  async saveToJson() {
    const data = {
      epochs: this.epochData,
      blocks: this.blockData
    };

    try {
      await fs.promises.writeFile(
        'validator_data.json',
        JSON.stringify(data, null, 2)
      );
    } catch (error) {
      console.error("Error saving to JSON:", error);
    }
  }

  // Rest of the class remains exactly the same
  async start() {
    try {
      console.log("Starting block validator...");
      await this.updateValidatorList();
      await this.connectWebSocket();
    } catch (error) {
      console.error("Error starting validator:", error);
      process.exit(1);
    }
  }

  async connectWebSocket() {
    this.ws = new WebSocket(config.wsUrl);

    this.ws.on("open", () => {
      console.log("WebSocket connected");
      this.ws.send(
        JSON.stringify({
          method: "eth_subscribe",
          params: ["newHeads"],
          id: 1,
        })
      );
    });

    this.ws.on("message", async (data) => {
      try {
        const message = JSON.parse(data);
        if (message.params?.result?.number) {
          await this.handleNewBlock(message.params.result);
        }
      } catch (error) {
        console.error("Error processing message:", error);
      }
    });

    this.ws.on("error", (error) => {
      console.error("WebSocket error:", error);
    });

    this.ws.on("close", () => {
      console.log("WebSocket closed, attempting to reconnect in 5 seconds...");
      setTimeout(() => this.connectWebSocket(), 5000);
    });
  }

  async updateValidatorList() {
    try {
      const validators = await this.contract.getValidators();
      this.validatorCache.validators = validators;
    } catch (error) {
      console.error("Error updating validator list:", error);
    }
  }
}

// Start the validator
const validator = new BlockValidator();
validator.start();