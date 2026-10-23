import { ACTION, swapReducer } from './Swap';

jest.mock('../utils/constants', () => ({ DEFAULT_SLIPPAGE_PERCENT: 1 }));
jest.mock('../../../redux/actions/status', () => ({ showCustomAlert: jest.fn() }));

const tokenIn = { contractName: 'NEAR', onChainFTMetadata: { decimals: 24 } };
const tokenOut = { contractName: 'usdc.near' };
const quote = {
    context: {
        accountId: 'alice.near',
        tokenInId: 'NEAR',
        tokenOutId: 'usdc.near',
        amountIn: '1250000000000000000000000',
        slippage: '1',
    },
};
const state = {
    accountId: 'alice.near',
    tokenIn,
    tokenOut,
    amountIn: '1.25',
    slippage: 1,
    selectedQuote: quote,
};

describe('swap quote state', () => {
    test.each([
        [ACTION.SET_TOKEN_IN, tokenIn],
        [ACTION.SET_TOKEN_OUT, tokenOut],
    ])(
        'retains the quote when %s synchronizes the same token object',
        (type, payload) => {
            expect(swapReducer(state, { type, payload })).toBe(state);
        }
    );

    test.each([
        [ACTION.SET_AMOUNT_IN, '2'],
        [ACTION.SET_TOKEN_IN, { ...tokenIn }],
        [ACTION.SET_TOKEN_OUT, { ...tokenOut }],
        [ACTION.SET_SLIPPAGE, 3],
    ])('clears the quote on %s', (type, payload) => {
        expect(swapReducer(state, { type, payload }).selectedQuote).toBeNull();
    });

    test('rejects a quote returned after the input changed', () => {
        const changed = swapReducer(state, { type: ACTION.SET_AMOUNT_IN, payload: '2' });
        expect(
            swapReducer(changed, {
                type: ACTION.SET_SELECTED_QUOTE,
                payload: quote,
            }).selectedQuote
        ).toBeNull();
    });
});
