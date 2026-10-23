import React from 'react';
import ReactDOM from 'react-dom';
import { act } from 'react-dom/test-utils';

import useSwap from './useSwap';
import fungibleTokenExchange from '../../../../services/tokenExchange';

const mockDispatch = jest.fn();
const mockSetSwapPending = jest.fn();
const mockSetCompletedSwapState = jest.fn();
const mockSetViewState = jest.fn();
let mockSwapState;

jest.mock('react-redux', () => ({
    useDispatch: () => mockDispatch,
    useSelector: () => null,
}));
jest.mock('../../../../config', () => ({
    __esModule: true,
    default: { NEAR_TOKEN_ID: 'wrap.near' },
}));
jest.mock('../../../../mixpanel', () => ({ Mixpanel: { track: jest.fn() } }));
jest.mock('../../../../redux/actions/status', () => ({ showCustomAlert: jest.fn() }));
jest.mock(
    '../../../../redux/selectors/crossStateSelectors/selectNEARAsTokenWithMetadata',
    () => jest.fn()
);
jest.mock('../../../../redux/slices/swap', () => ({
    actions: { updateTokensBalance: jest.fn() },
}));
jest.mock('../../../../services/tokenExchange', () => ({
    __esModule: true,
    default: {
        swap: jest.fn(),
        replaceNearIdIfNecessary: (id) => id,
    },
}));
jest.mock('../../model/Swap', () => ({
    VIEW_STATE: { result: 'result' },
    useSwapData: () => ({
        swapState: mockSwapState,
        events: {
            setSelectedQuote: jest.fn(),
            setSwapPending: mockSetSwapPending,
            setCompletedSwapState: mockSetCompletedSwapState,
            setViewState: mockSetViewState,
        },
    }),
}));
jest.mock('../quote', () => ({ quoteMatchesState: () => true }));

const tokenIn = {
    contractName: 'a.near',
    onChainFTMetadata: { symbol: 'A' },
    fiatValueMetadata: { usd: 1 },
};
const tokenOut = {
    contractName: 'b.near',
    onChainFTMetadata: { symbol: 'B' },
};
const account = { accountId: 'alice.near' };
const quote = { minAmountOut: '2', routeTokenIds: ['route.near'] };

describe('pending swap result', () => {
    let root;
    let swap;
    let resolveSwap;

    function Harness() {
        swap = useSwap({ account, amountIn: '1', quote, tokenIn, tokenOut, slippage: 1 });
        return null;
    }

    beforeEach(() => {
        root = document.createElement('div');
        document.body.appendChild(root);
        mockSwapState = { selectedQuote: quote, accountId: account.accountId };
        mockSetCompletedSwapState.mockClear();
        mockSetViewState.mockClear();
        fungibleTokenExchange.swap.mockClear();
        fungibleTokenExchange.swap.mockImplementation(
            () =>
                new Promise((resolve) => {
                    resolveSwap = resolve;
                })
        );
    });

    afterEach(() => {
        act(() => {
            ReactDOM.unmountComponentAtNode(root);
        });
        root.remove();
    });

    test('deduplicates confirmation and retains a broadcast result after quote invalidation', async () => {
        act(() => {
            ReactDOM.render(<Harness />, root);
        });
        let first;
        act(() => {
            first = swap();
            swap();
        });
        expect(fungibleTokenExchange.swap).toHaveBeenCalledTimes(1);

        mockSwapState = { ...mockSwapState, selectedQuote: null };
        act(() => {
            ReactDOM.render(<Harness />, root);
        });

        await act(async () => {
            resolveSwap({
                success: false,
                unconfirmed: true,
                swapTxHash: 'submitted-hash',
                quote,
            });
            await first;
        });

        expect(mockSetCompletedSwapState).toHaveBeenCalledWith(
            expect.objectContaining({
                accountId: 'alice.near',
                unconfirmed: true,
                hash: 'submitted-hash',
            })
        );
        expect(mockSetViewState).toHaveBeenCalledWith('result');
    });
});
