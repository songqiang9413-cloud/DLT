const { expect } = require("chai");
const { ethers } = require("hardhat");

const TEAM = "0x45F3aE8A36A1bC263AC5543d6876Dc37542F1785";

describe("smoke: deploy on Base fork", function () {
  it("deploys and wires up", async function () {
    const [deployer] = await ethers.getSigners();
    const Lottery = await ethers.getContractFactory("Lottery");
    const lottery = await Lottery.deploy(deployer.address);
    await lottery.waitForDeployment();

    const dltAddr = await lottery.dlt();
    const dlt = await ethers.getContractAt("DLT", dltAddr);

    console.log("  Lottery:", await lottery.getAddress());
    console.log("  DLT    :", dltAddr);
    console.log("  admin  :", await lottery.admin());
    console.log("  team   :", await lottery.team());
    console.log("  lottery in DLT:", await dlt.lottery());
    console.log("  router :", await dlt.router());
    console.log("  WETH   :", await dlt.WETH_ADDRESS());
    console.log("  symbol :", await dlt.symbol(), "decimals:", await dlt.decimals());
    expect(await dlt.lottery()).to.equal(await lottery.getAddress());
    expect(await lottery.admin()).to.equal(deployer.address);
    expect(await lottery.INITIAL_TEAM()).to.equal(TEAM);
    expect(await lottery.team()).to.equal(TEAM);
    expect(await lottery.TEAM_CHANGE_DELAY()).to.equal(24n * 60n * 60n);
  });
});