import { ApiV3PoolInfoStandardItem, AmmV4Keys, AmmRpcData } from '@raydium-io/raydium-sdk-v2'
import { initSdk, txVersion } from '../config'
import BN from 'bn.js'
import { isValidAmm } from './utils'
import Decimal from 'decimal.js'
import { NATIVE_MINT } from '@solana/spl-token'
import { printSimulateInfo } from '../util'
import { PublicKey } from '@solana/web3.js'

interface SwapConfig {
  amountIn: number
  inputMint?: string
  poolId: string
  slippage?: number
  sendAndConfirm?: boolean
  computeBudgetConfig?: {
    units: number
    microLamports: number
  }
  txTipConfig?: {
    address: PublicKey
    amount: BN
  }
}

interface SwapResult {
  txId: string
  amountIn: string
  amountOut: string
  minAmountOut: string
  inputToken: string
  outputToken: string
}

export const swap = async (config: SwapConfig): Promise<SwapResult> => {
  try {
    const {
      amountIn,
      inputMint = NATIVE_MINT.toBase58(),
      poolId,
      slippage = 0.01,
      sendAndConfirm = true,
      computeBudgetConfig,
      txTipConfig
    } = config

    const raydium = await initSdk()
    let poolInfo: ApiV3PoolInfoStandardItem | undefined
    let poolKeys: AmmV4Keys | undefined
    let rpcData: AmmRpcData

    // Fetch pool information based on network
    if (raydium.cluster === 'mainnet') {
      const data = await raydium.api.fetchPoolById({ ids: poolId })
      poolInfo = data[0] as ApiV3PoolInfoStandardItem
      if (!isValidAmm(poolInfo.programId)) {
        throw new Error('Target pool is not a valid AMM pool')
      }
      poolKeys = await raydium.liquidity.getAmmPoolKeys(poolId)
      rpcData = await raydium.liquidity.getRpcPoolInfo(poolId)
    } else {
      const data = await raydium.liquidity.getPoolInfoFromRpc({ poolId })
      poolInfo = data.poolInfo
      poolKeys = data.poolKeys
      rpcData = data.poolRpcData
    }

    if (!poolInfo || !poolKeys) {
      throw new Error('Failed to fetch pool information')
    }

    const [baseReserve, quoteReserve, status] = [
      rpcData.baseReserve,
      rpcData.quoteReserve,
      rpcData.status.toNumber()
    ]

    // Validate input mint
    if (poolInfo.mintA.address !== inputMint && poolInfo.mintB.address !== inputMint) {
      throw new Error('Input mint does not match pool configuration')
    }

    const baseIn = inputMint === poolInfo.mintA.address
    const [mintIn, mintOut] = baseIn 
      ? [poolInfo.mintA, poolInfo.mintB] 
      : [poolInfo.mintB, poolInfo.mintA]

    // Calculate swap amounts
    const out = raydium.liquidity.computeAmountOut({
      poolInfo: {
        ...poolInfo,
        baseReserve,
        quoteReserve,
        status,
        version: 4,
      },
      amountIn: new BN(amountIn),
      mintIn: mintIn.address,
      mintOut: mintOut.address,
      slippage,
    })

    const formattedAmountIn = new Decimal(amountIn)
      .div(10 ** mintIn.decimals)
      .toDecimalPlaces(mintIn.decimals)
      .toString()

    const formattedAmountOut = new Decimal(out.amountOut.toString())
      .div(10 ** mintOut.decimals)
      .toDecimalPlaces(mintOut.decimals)
      .toString()

    const formattedMinAmountOut = new Decimal(out.minAmountOut.toString())
      .div(10 ** mintOut.decimals)
      .toDecimalPlaces(mintOut.decimals)
      .toString()

    console.log(
      `Computed swap: ${formattedAmountIn} ${mintIn.symbol || mintIn.address} to ` +
      `${formattedAmountOut} ${mintOut.symbol || mintOut.address}, ` +
      `minimum amount out: ${formattedMinAmountOut} ${mintOut.symbol || mintOut.address}`
    )

    // Execute swap
    const { execute } = await raydium.liquidity.swap({
      poolInfo,
      poolKeys,
      amountIn: new BN(amountIn),
      amountOut: out.minAmountOut,
      fixedSide: 'in',
      inputMint: mintIn.address,
      txVersion,
      computeBudgetConfig,
      txTipConfig,
    })

    printSimulateInfo()
    
    const { txId } = await execute({ sendAndConfirm })
    console.log(`Swap successful in AMM pool:`, { 
      txId: `https://explorer.solana.com/tx/${txId}` 
    })

    return {
      txId,
      amountIn: formattedAmountIn,
      amountOut: formattedAmountOut,
      minAmountOut: formattedMinAmountOut,
      inputToken: mintIn.symbol || mintIn.address,
      outputToken: mintOut.symbol || mintOut.address
    }
  } catch (error) {
    console.error('Swap failed:', error)
    throw error
  }
}

/** Example usage:
 * 
 * await swap({
 *   amountIn: 500,
 *   poolId: '58oQChx4yWmvKdwLLZzBi4ChoCc2fqCUWBkwMihLYQo2',
 *   slippage: 0.01,
 *   sendAndConfirm: true
 * })
 */
