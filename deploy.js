const hre = require("hardhat");

async function main() {
  // Official Semaphore v4 router/verifier address on Sepolia.
  // Confirm current address at https://docs.semaphore.pse.dev/deployed-contracts
  const SEMAPHORE_ADDRESS = process.env.SEMAPHORE_CONTRACT_ADDRESS;
  if (!SEMAPHORE_ADDRESS) {
    throw new Error("Set SEMAPHORE_CONTRACT_ADDRESS in .env before deploying");
  }

  const PrivateGovernance = await hre.ethers.getContractFactory("PrivateGovernance");
  const governance = await PrivateGovernance.deploy(SEMAPHORE_ADDRESS);
  const receipt = await governance.deploymentTransaction().wait();

  console.log("PrivateGovernance deployed to:", await governance.getAddress());
  console.log("Deployment block:", receipt.blockNumber);
  console.log("↳ copy this into VITE_GOVERNANCE_DEPLOY_BLOCK in your .env");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
