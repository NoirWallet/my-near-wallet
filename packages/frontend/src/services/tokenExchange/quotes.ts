import Big from 'big.js';
import { transactions } from 'near-api-js';

import { getTotalGasFee } from '../../utils/gasPrice';

const Decimal = Big();
Decimal.DP = 100;

export interface QuoteContext {
    accountId: string;
    tokenInId: string;
    tokenOutId: string;
    amountIn: string;
    slippage: string;
}

export interface SwapTransaction {
    receiverId: string;
    actions: transactions.Action[];
}

export interface QuoteRequest {
    account: Wallet.Account;
    tokenIn: Wallet.Token;
    tokenOut: Wallet.Token;
    amountIn: string;
    slippage: number;
    poolsByIds?: Record<string, unknown>;
    signal?: AbortSignal;
    context?: QuoteContext;
}

export interface SwapQuote {
    source: 'ref' | 'v2' | 'wrap';
    context: QuoteContext;
    amountOutRaw: string;
    minAmountOutRaw: string;
    amountOut: string;
    minAmountOut: string;
    outputDecimals: number;
    priceImpactPercent: string;
    swapFee: string | null;
    estimatedFee: string;
    transactions: SwapTransaction[];
    registrationKey: string;
    routeTokenIds: string[];
    execution: {
        poolId?: number;
        msg?: string;
        signature?: string;
        pendingTransactionIndex?: number;
        withdrawal?: boolean;
    };
}

export function toRaw(amount: string, decimals: number): string {
    if (
        !/^\d+(\.\d+)?$/.test(String(amount)) ||
        !Number.isInteger(decimals) ||
        decimals < 0
    ) {
        throw new Error('Invalid swap amount');
    }
    const raw = Big(amount).times(Big(10).pow(decimals));
    if (!raw.gt(0) || !raw.eq(raw.round(0, Big.roundDown))) {
        throw new Error('Invalid swap amount precision');
    }
    return raw.toFixed(0);
}

export function fromRaw(amount: string, decimals: number): string {
    if (!/^\d+$/.test(amount) || !Number.isInteger(decimals) || decimals < 0) {
        throw new Error('Invalid token amount');
    }
    const digits = Big(amount)
        .toFixed(0)
        .padStart(decimals + 1, '0');
    if (decimals === 0) {
        return digits;
    }
    const fraction = digits.slice(-decimals).replace(/0+$/, '');
    return digits.slice(0, -decimals) + (fraction ? `.${fraction}` : '');
}

export function createQuoteContext(params: QuoteRequest): QuoteContext {
    const { account, tokenIn, tokenOut, amountIn, slippage } = params;
    if (
        !account?.accountId ||
        !tokenIn ||
        !tokenOut ||
        !Number.isFinite(slippage) ||
        slippage < 0 ||
        slippage >= 100
    ) {
        throw new Error('Invalid swap request');
    }
    if (tokenIn.contractName === tokenOut.contractName) {
        throw new Error('Choose different swap tokens');
    }
    return {
        accountId: account.accountId,
        tokenInId: tokenIn.contractName,
        tokenOutId: tokenOut.contractName,
        amountIn: toRaw(amountIn, tokenIn.onChainFTMetadata.decimals),
        slippage: Big(slippage).toFixed(),
    };
}

export function sameQuoteContext(left: QuoteContext, right: QuoteContext): boolean {
    return (
        !!left &&
        !!right &&
        Object.keys(left).length === 5 &&
        (['accountId', 'tokenInId', 'tokenOutId', 'amountIn', 'slippage'] as const).every(
            (key) => left[key] === right[key]
        )
    );
}

// Both sources return output after exchange fees, in the same token's smallest units.
export function selectBestQuote(quotes: SwapQuote[]): SwapQuote {
    const best = quotes.reduce<SwapQuote>((selected, quote) => {
        if (!selected) {
            return quote;
        }
        if (!sameQuoteContext(selected.context, quote.context)) {
            throw new Error('Cannot compare quotes for different swaps');
        }
        const comparison = Big(quote.amountOutRaw).cmp(selected.amountOutRaw);
        return comparison > 0 || (comparison === 0 && quote.source === 'ref')
            ? quote
            : selected;
    }, null);
    if (!best) {
        throw new Error('No swap quote available. Please try again.');
    }
    return best;
}

export function requiresQuoteReview(previous: SwapQuote, fresh: SwapQuote): boolean {
    return (
        !sameQuoteContext(previous.context, fresh.context) ||
        previous.source !== fresh.source ||
        Big(fresh.minAmountOutRaw).lt(previous.minAmountOutRaw) ||
        Big(fresh.estimatedFee).gt(previous.estimatedFee) ||
        fresh.registrationKey !== previous.registrationKey ||
        Big(fresh.priceImpactPercent).gt(6)
    );
}

export function getUsdPriceImpact({
    amountIn,
    amountOut,
    priceIn,
    priceOut,
}: {
    amountIn: string;
    amountOut: string;
    priceIn: string | number;
    priceOut: string | number;
}): string {
    if (
        !priceIn ||
        !priceOut ||
        !Big(priceIn).gt(0) ||
        !Big(priceOut).gt(0) ||
        !Big(amountIn).gt(0)
    ) {
        throw new Error('Token prices unavailable for SmartRouter V2');
    }
    const impact = Decimal(1)
        .minus(Decimal(amountOut).times(priceOut).div(Decimal(amountIn).times(priceIn)))
        .times(100);
    return impact.gt(0) ? impact.toFixed() : '0';
}

export async function getTransactionFee(
    _account: Wallet.Account,
    txs: SwapTransaction[],
    { nativePrincipalRaw = '0' }: { nativePrincipalRaw?: string } = {}
): Promise<string> {
    let gas = Big(0);
    let deposit = Big(0);
    txs.forEach((tx) =>
        tx.actions.forEach((action) => {
            const call = action.functionCall;
            if (call) {
                gas = gas.plus(call.gas.toString());
                deposit = deposit.plus(call.deposit.toString());
            }
        })
    );
    const gasFee = await getTotalGasFee(gas.toFixed(0));
    return fromRaw(Big(gasFee).plus(deposit).minus(nativePrincipalRaw).toFixed(0), 24);
}
