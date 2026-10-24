import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

const deployModule2: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();
  const { deploy } = hre.deployments;

  // Step 1: Get the already-deployed IdentityRegistry address
  const identityRegistry = await hre.deployments.get("IdentityRegistry");
  console.log("IdentityRegistry found at:", identityRegistry.address);

  // Step 2: Deploy SkillBadge (needs registry address + base URI)
  const skillBadge = await deploy("SkillBadge", {
    from: deployer,
    args: [
      identityRegistry.address,
      "", // Base URI unused — uri() is overridden to reconstruct IPFS links from metadataCID
    ],
    log: true,
    autoMine: true,
  });
  console.log("SkillBadge deployed at:", skillBadge.address);

  // Step 3: Deploy SkillGraph (needs registry + badge + base URI)
  const skillGraph = await deploy("SkillGraph", {
    from: deployer,
    args: [
      identityRegistry.address,
      skillBadge.address,
      "", // Base URI unused — uri() is overridden to reconstruct IPFS links from metadataCID
    ],
    log: true,
    autoMine: true,
  });
  console.log("SkillGraph deployed at:", skillGraph.address);

  // Step 4: Deploy SkillPath (needs registry + graph)
  const skillPath = await deploy("SkillPath", {
    from: deployer,
    args: [identityRegistry.address, skillGraph.address],
    log: true,
    autoMine: true,
  });
  console.log("SkillPath deployed at:", skillPath.address);
};

export default deployModule2;

// Ensures Module 1 deploys first
deployModule2.dependencies = ["IdentityRegistry"];
deployModule2.tags = ["Module2"];
