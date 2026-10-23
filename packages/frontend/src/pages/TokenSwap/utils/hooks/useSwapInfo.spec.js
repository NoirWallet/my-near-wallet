import React from 'react';
import ReactDOM from 'react-dom';
import { act } from 'react-dom/test-utils';

import useSwapInfo from './useSwapInfo';
import fungibleTokenExchange from '../../../../services/tokenExchange';

const mockSetSelectedQuote = jest.fn();

jest.mock('../../model/Swap', () => ({
    useSwapData: () => ({ events: { setSelectedQuote: mockSetSelectedQuote } }),
}));
jest.mock('./usePools', () => () => ({ pools: null }));
jest.mock('../../../../services/tokenExchange', () => ({
    __esModule: true,
    default: { estimate: jest.fn() },
}));
jest.mock('../constants', () => ({
    SWAP_INFO_DELAY: 400,
    NOTIFICATION_TYPE: { warning: 'warning', error: 'error' },
}));

const tokenIn = { contractName: 'NEAR', onChainFTMetadata: { symbol: 'NEAR' } };
const tokenOut = { contractName: 'usdc.near', onChainFTMetadata: { symbol: 'USDC' } };
const account = { accountId: 'alice.near' };

describe('swap quote requests', () => {
    let root;
    let requests;

    function Harness({ amountIn }) {
        useSwapInfo({ account, tokenIn, tokenOut, amountIn, slippage: 1 });
        return null;
    }

    beforeEach(() => {
        jest.useFakeTimers();
        root = document.createElement('div');
        document.body.appendChild(root);
        requests = [];
        mockSetSelectedQuote.mockClear();
        fungibleTokenExchange.estimate.mockImplementation(
            (params) =>
                new Promise((resolve) => {
                    requests.push({ params, resolve });
                })
        );
    });

    afterEach(() => {
        act(() => {
            ReactDOM.unmountComponentAtNode(root);
        });
        root.remove();
        jest.useRealTimers();
    });

    test('requests a quote without a Ref pool and ignores an older response', async () => {
        act(() => {
            ReactDOM.render(<Harness amountIn='1' />, root);
        });
        expect(requests).toHaveLength(1);
        expect(requests[0].params.poolsByIds).toBeNull();

        act(() => {
            ReactDOM.render(<Harness amountIn='2' />, root);
        });
        expect(requests[0].params.signal.aborted).toBe(true);
        expect(requests).toHaveLength(1);

        await act(async () => {
            requests[0].resolve({ amountOut: '10' });
            await Promise.resolve();
        });
        expect(mockSetSelectedQuote).not.toHaveBeenCalled();

        act(() => jest.advanceTimersByTime(400));
        expect(requests).toHaveLength(2);

        const latest = { amountOut: '20' };
        await act(async () => {
            requests[1].resolve(latest);
            await Promise.resolve();
        });
        expect(mockSetSelectedQuote).toHaveBeenCalledWith(latest);
    });
});
