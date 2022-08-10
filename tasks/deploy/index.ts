import "./deploy";
import { task } from "hardhat/config";
import fs from "fs";
import { TaskArguments } from "hardhat/types";
import { FlashBackLM } from "../../typechain";

// This will generate a CSV file using random inputs of amount and duration
// as well as the expected output reward for analysis.
task("generate:FlashBackLM")
  .addParam("flashbackaddress", "The token to be staked")
  .addParam("outputfile", "The tier, basically what to name the output file")
  .setAction(async function (taskArguments: TaskArguments, { ethers }) {
    const [wallet1] = await ethers.getSigners();

    const flashBackContract: FlashBackLM = <FlashBackLM>(
      await ethers.getContractAt("FlashBackLM", taskArguments.flashbackaddress)
    );

    const _totalEntries = 100;
    const _minTokenAStaked = 0.001;
    const _maxTokenAStaked = 1000;
    const _minTimeStaked = (await flashBackContract.minimumStakeDuration()).toNumber();
    const _maxTimeStaked = (await flashBackContract.maximumStakeDuration()).toNumber();

    let dataToFile = "_amount,_duration,reward\n";

    for (let i = 0; i < _totalEntries; i++) {
      let tokenAToStake = genRand(_minTokenAStaked, _maxTokenAStaked, 4);
      let timeToStake = genRand(_minTimeStaked, _maxTimeStaked, 0);

      // Convert to a BigNumber
      const tokensAToStakeBN = ethers.utils.parseUnits(tokenAToStake + "", 18);

      let result = await flashBackContract.calculateReward(tokensAToStakeBN, timeToStake);

      console.log({
        _amount: tokensAToStakeBN,
        _duration: timeToStake,
        reward: result,
      });
      dataToFile = dataToFile + tokensAToStakeBN + "," + timeToStake + "," + result + "\n";
    }

    // Write to file sync
    fs.writeFileSync(taskArguments.outputfile, dataToFile);
  });

function genRand(min: number, max: number, decimalPlaces: number) {
  var rand = Math.random() * (max - min) + min;
  var power = Math.pow(10, decimalPlaces);
  return Math.floor(rand * power) / power;
}
