import { expect } from 'chai'
import { ethers } from 'hardhat'
import { ContractFactory } from 'ethers'
import { contracts, CTokenV3Collateral, InvalidMockV3Aggregator, MockV3Aggregator } from '../typechain-types'
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'
import {
  USDC_HOLDER,
  RTOKEN_MAX_TRADE_VOL,
  ORACLE_TIMEOUT,
  DEFAULT_THRESHOLD,
  DELAY_UNTIL_DEFAULT,
  ZERO_ADDRESS,
  CollateralStatus,
  MAX_UINT256,
  getLatestBlockTimestamp,
  setNextBlockTimestamp,
  exp,
  advanceTime,
  allocateERC20,
  ETH_USD_PRICE_FEED,
  CBETH,
  ETH_DECIMALS,
} from './helpers'
import { deployCollateral, makeCbETHCollateralFactory } from './fixtures'

/* types of test :
  1) constructor validation - test with wrong parameters and it should revert with errors (done)
  2) price - check find on different situations, you change price and try to check if the 
     exchangeRate(refPerTok, strictPrice, etc.) are equal to your expectations
  3) status - Check if status changes on different situations. Example of situtions
     (a) When everything is normal 
     (b) When the USDC move from its peg
*/

describe('constructor validation', () => {
  let CbETHCollateral: ContractFactory

  beforeEach(async () => {
    CbETHCollateral = await makeCbETHCollateralFactory()
  })

  it('does not allow zero fallbackPrice', async () => {
    await expect(
      CbETHCollateral.deploy(
        0,
        ETH_USD_PRICE_FEED,
        CBETH,
        RTOKEN_MAX_TRADE_VOL,
        ORACLE_TIMEOUT,
        ethers.utils.formatBytes32String('ETH'),
        DEFAULT_THRESHOLD,
        DELAY_UNTIL_DEFAULT,
        ETH_DECIMALS
      )
    ).to.be.revertedWith('fallback price zero')
  })

  it('does not allow zero address targetUnitChainlinkFeed', async () => {
    await expect(
      CbETHCollateral.deploy(
        1,
        ZERO_ADDRESS,
        CBETH,
        RTOKEN_MAX_TRADE_VOL,
        ORACLE_TIMEOUT,
        ethers.utils.formatBytes32String('ETH'),
        DEFAULT_THRESHOLD,
        DELAY_UNTIL_DEFAULT,
        ETH_DECIMALS
      )
    ).to.be.revertedWith('missing chainlink feed')
  })

  it('does not allow zero address erc20metadata', async () => {
    await expect(
      CbETHCollateral.deploy(
        1,
        ETH_USD_PRICE_FEED,
        ZERO_ADDRESS,
        RTOKEN_MAX_TRADE_VOL,
        ORACLE_TIMEOUT,
        ethers.utils.formatBytes32String('ETH'),
        DEFAULT_THRESHOLD,
        DELAY_UNTIL_DEFAULT,
        ETH_DECIMALS
      )
    ).to.be.revertedWith('missing erc20')
  })

  it('validates maxTradeVolume', async () => {
    await expect(
      CbETHCollateral.deploy(
        1,
        ETH_USD_PRICE_FEED,
        CBETH,
        0,
        ORACLE_TIMEOUT,
        ethers.utils.formatBytes32String('ETH'),
        DEFAULT_THRESHOLD,
        DELAY_UNTIL_DEFAULT,
        ETH_DECIMALS
      )
    ).to.be.revertedWith('invalid max trade volume')
  })

  it('validates oracleTimeout', async () => {
    await expect(
      CbETHCollateral.deploy(
        1,
        ETH_USD_PRICE_FEED,
        CBETH,
        RTOKEN_MAX_TRADE_VOL,
        0,
        ethers.utils.formatBytes32String('ETH'),
        DEFAULT_THRESHOLD,
        DELAY_UNTIL_DEFAULT,
        ETH_DECIMALS
      )
    ).to.be.revertedWith('oracleTimeout zero')
  })

  it('validates targetName correctly', async () => {
    await expect(
      CbETHCollateral.deploy(
        1,
        ETH_USD_PRICE_FEED,
        CBETH,
        RTOKEN_MAX_TRADE_VOL,
        ORACLE_TIMEOUT,
        ethers.constants.HashZero,
        DEFAULT_THRESHOLD,
        DELAY_UNTIL_DEFAULT,
        ETH_DECIMALS
      )
    ).to.be.revertedWith('targetName missing')
  })

  it('does not allow missing defaultThreshold', async () => {
    await expect(
      CbETHCollateral.deploy(
        1,
        ETH_USD_PRICE_FEED,
        CBETH,
        RTOKEN_MAX_TRADE_VOL,
        ORACLE_TIMEOUT,
        ethers.utils.formatBytes32String('ETH'),
        0,
        DELAY_UNTIL_DEFAULT,
        ETH_DECIMALS
      )
    ).to.be.revertedWith('defaultThreshold zero')
  })

  it('does not allow missing delayUntilDefault', async () => {
    await expect(
      CbETHCollateral.deploy(
        1,
        ETH_USD_PRICE_FEED,
        CBETH,
        RTOKEN_MAX_TRADE_VOL,
        ORACLE_TIMEOUT,
        ethers.utils.formatBytes32String('ETH'),
        DEFAULT_THRESHOLD,
        0,
        ETH_DECIMALS
      )
    ).to.be.revertedWith('delayUntilDefault zero')
  })

  it('does not allow missing referenceERC20Decimals', async () => {
    await expect(
      CbETHCollateral.deploy(
        1,
        ETH_USD_PRICE_FEED,
        CBETH,
        RTOKEN_MAX_TRADE_VOL,
        ORACLE_TIMEOUT,
        ethers.utils.formatBytes32String('ETH'),
        DEFAULT_THRESHOLD,
        DELAY_UNTIL_DEFAULT,
        0
      )
    ).to.be.revertedWith('referenceERC20Decimals missing')
  })
})

describe('prices', () => {
  it('prices change as cbETH feed price changes', async () => {
    const { collateral, chainlinkFeed } = await loadFixture(deployCollateral)
    const { answer } = await chainlinkFeed.latestRoundData()
    const decimals = await chainlinkFeed.decimals()
    const expectedPrice = exp(answer.toBigInt(), 18 - decimals)

    // Check initial prices
    expect(await collateral.strictPrice()).to.equal(expectedPrice)

    // Check refPerTok initial values
    const expectedRefPerTok = exp(1, 18)
    expect(await collateral.refPerTok()).to.equal(expectedRefPerTok) // should equal 1e18

    // Update values in Oracles increase by 10-20%
    const newPrice = exp(11, 7)
    const updateAnswerTx = await chainlinkFeed.updateAnswer(newPrice)
    await updateAnswerTx.wait()

    // Check new prices
    expect(await collateral.strictPrice()).to.equal(exp(newPrice, 18 - decimals))

    // Check refPerTok remains the same
    expect(await collateral.refPerTok()).to.equal(expectedRefPerTok)
  })

  it('prices change as refPerTok changes', async () => {
    const { collateral, cbeth } = await loadFixture(deployCollateral)
    const prevRefPerTok = await collateral.refPerTok()
    const prevPrice = await collateral.strictPrice()
    expect(prevRefPerTok).to.equal(exp(1, 18))
    expect(prevPrice).to.equal(exp(1, 18))

    const [_, bob] = await ethers.getSigners()
    const cbETHAsB = cbeth.connect(bob)
    // const cusdcV3AsB = cusdcV3.connect(bob)
    // const wcusdcV3AsB = wcusdcV3.connect(bob)

    const balance = 20000e6
    await allocateERC20(cbeth, USDC_HOLDER, bob.address, balance)

    // await usdcAsB.approve(CUSDC_V3, ethers.constants.MaxUint256)
    // await cusdcV3AsB.supply(USDC, balance)
    expect(await cbeth.balanceOf(bob.address)).to.equal(0)

    // await cusdcV3AsB.allow(wcusdcV3.address, true)
    // await wcusdcV3AsB.depositFor(bob.address, ethers.constants.MaxUint256)
    expect(await collateral.refPerTok()).to.not.equal(prevRefPerTok)
    expect(await collateral.strictPrice()).to.not.equal(prevPrice)
  })

  it('reverts if price is zero', async () => {
    const { collateral, chainlinkFeed } = await loadFixture(deployCollateral)

    // Set price of USDC to 0
    const updateAnswerTx = await chainlinkFeed.updateAnswer(0)
    await updateAnswerTx.wait()

    // Check price of token
    await expect(collateral.strictPrice()).to.be.revertedWithCustomError(
      collateral,
      'PriceOutsideRange'
    )

    // Fallback price is returned
    const [isFallback, price] = await collateral.price(true)
    expect(isFallback).to.equal(true)
    expect(price).to.equal(await collateral.fallbackPrice())

    // When refreshed, sets status to Unpriced
    await collateral.refresh()
    expect(await collateral.status()).to.equal(CollateralStatus.IFFY)
  })

  it('reverts in case of invalid timestamp', async () => {
    const { collateral, chainlinkFeed } = await loadFixture(deployCollateral)
    await chainlinkFeed.setInvalidTimestamp()

    // Check price of token
    await expect(collateral.strictPrice()).to.be.revertedWithCustomError(collateral, 'StalePrice')

    // When refreshed, sets status to Unpriced
    await collateral.refresh()
    expect(await collateral.status()).to.equal(CollateralStatus.IFFY)
  })
})

describe('status', () => {
  let collateral: CTokenV3Collateral
  let chainlinkFeed: MockV3Aggregator

  beforeEach(async () => {
    ;({ collateral, chainlinkFeed } = await loadFixture(deployCollateral))
  })

  it('maintains status in normal situations', async () => {
    // Check initial state
    expect(await collateral.status()).to.equal(CollateralStatus.SOUND)
    expect(await collateral.whenDefault()).to.equal(MAX_UINT256)

    // Force updates (with no changes)
    await expect(collateral.refresh()).to.not.emit(collateral, 'DefaultStatusChanged')

    // State remains the same
    expect(await collateral.status()).to.equal(CollateralStatus.SOUND)
    expect(await collateral.whenDefault()).to.equal(MAX_UINT256)
  })

  it('updates status in case of soft default', async () => {
    const delayUntilDefault = (await collateral.delayUntilDefault()).toBigInt()

    // Check initial state
    expect(await collateral.status()).to.equal(CollateralStatus.SOUND)
    expect(await collateral.whenDefault()).to.equal(MAX_UINT256)

    // Depeg USDC:USD - Reducing price by 20% from 1 to 0.8
    const updateAnswerTx = await chainlinkFeed.updateAnswer(8n * 10n ** 5n)
    await updateAnswerTx.wait()

    // Force updates - Should update whenDefault and status
    let expectedDefaultTimestamp: bigint

    // Set next block timestamp - for deterministic result
    const nextBlockTimestamp = (await getLatestBlockTimestamp()) + 1
    await setNextBlockTimestamp(nextBlockTimestamp)
    expectedDefaultTimestamp = BigInt(nextBlockTimestamp) + delayUntilDefault

    await expect(collateral.refresh())
      .to.emit(collateral, 'DefaultStatusChanged')
      .withArgs(CollateralStatus.SOUND, CollateralStatus.IFFY)
    expect(await collateral.status()).to.equal(CollateralStatus.IFFY)
    expect(await collateral.whenDefault()).to.equal(expectedDefaultTimestamp)

    // Move time forward past delayUntilDefault
    await advanceTime(Number(delayUntilDefault))
    expect(await collateral.status()).to.equal(CollateralStatus.DISABLED)

    // Nothing changes if attempt to refresh after default for CTokenV3
    let prevWhenDefault: bigint = (await collateral.whenDefault()).toBigInt()
    await expect(collateral.refresh()).to.not.emit(collateral, 'DefaultStatusChanged')
    expect(await collateral.status()).to.equal(CollateralStatus.DISABLED)
    expect(await collateral.whenDefault()).to.equal(prevWhenDefault)
  })

  it('updates status in case of hard default', async () => {
    // It is not possible for CTokenV3Colllateral to hard default because {ref/tok} is
    // always 1 since USDC (ref) is always 1:1 with cUSDCV3 (tok).
  })

  it('reverts if price is stale', async () => {
    await advanceTime(ORACLE_TIMEOUT.toString())
    // Check new prices
    await expect(collateral.strictPrice()).to.be.revertedWithCustomError(collateral, 'StalePrice')
  })

  it('enters IFFY state when price becomes stale', async () => {
    await advanceTime(ORACLE_TIMEOUT.toString())
    await collateral.refresh()
    expect(await collateral.status()).to.equal(CollateralStatus.IFFY)
  })

  it('reverts if Chainlink feed reverts or runs out of gas, maintains status', async () => {
    const InvalidMockV3AggregatorFactory = await ethers.getContractFactory(
      'InvalidMockV3Aggregator'
    )
    const invalidChainlinkFeed: InvalidMockV3Aggregator = <InvalidMockV3Aggregator>(
      await InvalidMockV3AggregatorFactory.deploy(6, 1n * 10n ** 6n)
    )

    const CbETHCollateral = await makeCbETHCollateralFactory()
    const invalidCollateral = await CbETHCollateral.deploy(
      1,
      invalidChainlinkFeed.address,
      await collateral.erc20(),
      await collateral.maxTradeVolume(),
      await collateral.oracleTimeout(),
      await collateral.targetName(),
      await collateral.defaultThreshold(),
      await collateral.delayUntilDefault(),
      await collateral.referenceERC20Decimals()
    )

    // Reverting with no reason
    await invalidChainlinkFeed.setSimplyRevert(true)
    await expect(invalidCollateral.refresh()).to.be.revertedWithoutReason()
    expect(await invalidCollateral.status()).to.equal(CollateralStatus.SOUND)

    // Runnning out of gas (same error)
    await invalidChainlinkFeed.setSimplyRevert(false)
    await expect(invalidCollateral.refresh()).to.be.revertedWithoutReason()
    expect(await invalidCollateral.status()).to.equal(CollateralStatus.SOUND)
  })
})
