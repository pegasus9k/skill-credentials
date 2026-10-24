import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

/**
 * 02_bootstrap_roles.ts
 *
 * Post-deployment bootstrap: the HEI Admin (Account #1) anchors the two
 * backend service keys, and the deployer renounces its temporary root role
 * last. Students are anchored by the registrar later, never here.
 *
 * Account layout (Hardhat default):
 *   #0  Deployer        0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
 *   #1  HEI Admin       0x70997970C51812dc3A010C7d01b50e0d17dc79C8
 *   #5  Oracle service  0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc  (backend ORACLE_PRIVATE_KEY)
 *   #6  Registrar       0x976EA74026E726554dB657fA54763abd0C3a0aa9  (backend REGISTRAR_PRIVATE_KEY)
 *
 * Mirrors the test beforeEach() setup and Module 1 §5 bootstrap sequence:
 *   1. HEI Admin anchors Registrar      → Account #6 (registrar service key)
 *   2. HEI Admin anchors Oracle         → Account #5 (oracle service key)
 *   3. Deployer calls renounceAdmin()   → no address holds DEFAULT_ADMIN_ROLE
 *
 * Every step checks hasRole() first, so a second yarn deploy on the same
 * chain skips what is already done.
 */
const bootstrapRoles: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const signers = await hre.ethers.getSigners();
  const deployer = signers[0];
  const heiAdmin = signers[1];
  const oracle = signers[5];
  const registrar = signers[6];

  // Get the deployed IdentityRegistry contract
  const registryDeployment = await hre.deployments.get("IdentityRegistry");
  const registry = await hre.ethers.getContractAt("IdentityRegistry", registryDeployment.address);

  // Read role constants
  const DEFAULT_ADMIN_ROLE = await registry.DEFAULT_ADMIN_ROLE();
  const REGISTRAR_ROLE = await registry.REGISTRAR_ROLE();
  const ORACLE_ROLE = await registry.ORACLE_ROLE();

  console.log("\n  ══════════════════════════════════════");
  console.log("  Bootstrap: Role Assignment");
  console.log("  ══════════════════════════════════════");

  // 1. HEI Admin anchors the Registrar, Account #6 (backend service key)
  const hasRegistrar = await registry.hasRole(REGISTRAR_ROLE, registrar.address);
  if (!hasRegistrar) {
    const tx1 = await registry.connect(heiAdmin).anchorRegistrar(registrar.address);
    await tx1.wait();
    console.log(`  ✓ REGISTRAR_ROLE → ${registrar.address} (registrar)`);
  } else {
    console.log(`  · REGISTRAR_ROLE already granted to registrar`);
  }

  // 2. HEI Admin grants ORACLE_ROLE to Account #5
  const hasOracle = await registry.hasRole(ORACLE_ROLE, oracle.address);
  if (!hasOracle) {
    const tx2 = await registry.connect(heiAdmin).anchorOracle(oracle.address);
    await tx2.wait();
    console.log(`  ✓ ORACLE_ROLE    → ${oracle.address} (oracle)`);
  } else {
    console.log(`  · ORACLE_ROLE already granted to oracle`);
  }

  // 3. Deployer renounces the temporary root role, last. Afterwards no address
  //    holds DEFAULT_ADMIN_ROLE, and HEI Admin is the highest role.
  console.log("  ──────────────────────────────────────");
  console.log("  Bootstrap: Root Role");
  console.log("  ──────────────────────────────────────");

  const hasRoot = await registry.hasRole(DEFAULT_ADMIN_ROLE, deployer.address);
  if (hasRoot) {
    const tx4 = await registry.connect(deployer).renounceAdmin();
    await tx4.wait();
    console.log(`  ✓ DEFAULT_ADMIN_ROLE renounced by ${deployer.address} (deployer)`);
  } else {
    console.log(`  · DEFAULT_ADMIN_ROLE already renounced by deployer`);
  }

  console.log("  ──────────────────────────────────────");
  console.log("  Bootstrap complete.");
  console.log(`  HEI Admin:  ${heiAdmin.address}`);
  console.log(`  Registrar:  ${registrar.address}`);
  console.log(`  Oracle:     ${oracle.address}`);
  console.log("  ══════════════════════════════════════\n");
};

export default bootstrapRoles;

// Run after both contract deployments
bootstrapRoles.dependencies = ["IdentityRegistry", "Module2"];
bootstrapRoles.tags = ["Bootstrap"];
bootstrapRoles.runAtTheEnd = true;
