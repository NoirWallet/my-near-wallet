import Big from 'big.js';

export function quoteMatchesState(quote, state) {
    if (!quote?.context || !state.accountId || !state.tokenIn || !state.tokenOut) {
        return false;
    }

    const { accountId, tokenInId, tokenOutId, amountIn, slippage } = quote.context;
    if (
        accountId !== state.accountId ||
        tokenInId !== state.tokenIn.contractName ||
        tokenOutId !== state.tokenOut.contractName
    ) {
        return false;
    }

    try {
        const decimals = state.tokenIn.onChainFTMetadata.decimals;
        const rawAmount = Big(state.amountIn).times(Big(10).pow(decimals));
        return (
            rawAmount.gt(0) &&
            rawAmount.eq(rawAmount.round(0, Big.roundDown)) &&
            Big(amountIn).eq(rawAmount) &&
            Big(slippage).eq(state.slippage)
        );
    } catch {
        return false;
    }
}
