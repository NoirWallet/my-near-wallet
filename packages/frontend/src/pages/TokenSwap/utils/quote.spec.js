import { quoteMatchesState } from './quote';

const state = {
    accountId: 'alice.near',
    tokenIn: { contractName: 'NEAR', onChainFTMetadata: { decimals: 24 } },
    tokenOut: { contractName: 'usdc.near' },
    amountIn: '1.25',
    slippage: 1,
};

const quote = {
    context: {
        accountId: 'alice.near',
        tokenInId: 'NEAR',
        tokenOutId: 'usdc.near',
        amountIn: '1250000000000000000000000',
        slippage: '1',
    },
};

describe('selected swap quote', () => {
    test('matches the exact account and input snapshot', () => {
        expect(quoteMatchesState(quote, state)).toBe(true);
        expect(quoteMatchesState(quote, { ...state, accountId: 'bob.near' })).toBe(false);
        expect(quoteMatchesState(quote, { ...state, amountIn: '1.26' })).toBe(false);
        expect(quoteMatchesState(quote, { ...state, slippage: 3 })).toBe(false);
        expect(
            quoteMatchesState(quote, {
                ...state,
                tokenOut: { contractName: 'wrap.near' },
            })
        ).toBe(false);
    });

    test('rejects input precision that cannot be represented on chain', () => {
        expect(
            quoteMatchesState(quote, {
                ...state,
                amountIn: '1.2500000000000000000000001',
            })
        ).toBe(false);
    });
});
