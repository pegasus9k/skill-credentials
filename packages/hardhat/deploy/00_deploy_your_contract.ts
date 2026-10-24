import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

const deployIdentityRegistry: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();
  const { deploy } = hre.deployments;

  // Account #1 from Hardhat's test accounts acts as HEI Admin
  const heiAdmin = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";

  await deploy("IdentityRegistry", {
    from: deployer,
    args: [heiAdmin],
    log: true,
    autoMine: true,
  });
};

export default deployIdentityRegistry;
deployIdentityRegistry.tags = ["IdentityRegistry"];
