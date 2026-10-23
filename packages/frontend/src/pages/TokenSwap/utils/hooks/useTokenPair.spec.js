import React from 'react';
import ReactDOM from 'react-dom';
import { act } from 'react-dom/test-utils';

import useTokenPair from './useTokenPair';
import { SwapProvider, useSwapData } from '../../model/Swap';

jest.mock('react-redux', () => ({ useDispatch: () => jest.fn() }));
jest.mock('../../../../redux/actions/status', () => ({ showCustomAlert: jest.fn() }));
jest.mock('../../../../config', () => ({
    __esModule: true,
    default: { CURRENT_NEAR_NETWORK: 'mainnet', USDT_CONTRACT: 'usdt.near' },
}));

const storageKey = 'swapTokenPair:mainnet';
const near = { contractName: 'NEAR', balance: '10' };
const usdt = { contractName: 'usdt.near', balance: '20' };
const usdc = { contractName: 'usdc.near', balance: '30' };

function tokenConfig(tokens, isLoadingAllTokens = false) {
    const byId = Object.fromEntries(tokens.map((token) => [token.contractName, token]));
    return {
        tokensIn: byId,
        tokensOut: byId,
        listOfTokensIn: tokens,
        listOfTokensOut: tokens,
        isLoadingAllTokens,
    };
}

describe('remembered swap pair', () => {
    let root;
    let data;

    function Harness({ config }) {
        useTokenPair(config);
        data = useSwapData();
        return null;
    }

    function render(config) {
        act(() => {
            ReactDOM.render(
                <SwapProvider accountId='alice.near'>
                    <Harness config={config} />
                </SwapProvider>, root
            );
        });
    }

    function unmount() {
        act(() => {
            ReactDOM.unmountComponentAtNode(root);
        });
    }

    beforeEach(() => {
        localStorage.clear();
        root = document.createElement('div');
        document.body.appendChild(root);
    });

    afterEach(() => {
        unmount();
        root.remove();
        jest.restoreAllMocks();
    });

    test('restores a flipped pair after loading with fresh balances and empty amounts', () => {
        render(tokenConfig([near, usdt, usdc]));
        act(() => {
            data.events.setTokenIn(usdc);
            data.events.setTokenOut(near);
            data.events.setAmountIn('5');
        });
        act(() => {
            const { tokenIn, tokenOut } = data.swapState;
            data.events.setTokenIn(tokenOut);
            data.events.setTokenOut(tokenIn);
        });
        expect(JSON.parse(localStorage.getItem(storageKey))).toEqual({
            tokenIn: 'NEAR', tokenOut: 'usdc.near',
        });
        unmount();

        render(tokenConfig([near], true));
        expect(JSON.parse(localStorage.getItem(storageKey)).tokenOut).toBe('usdc.near');
        const freshUsdc = { ...usdc, balance: '42' };
        render(tokenConfig([near, usdt, freshUsdc]));
        expect(data.swapState.tokenIn).toBe(near);
        expect(data.swapState.tokenOut).toBe(freshUsdc);
        expect(data.swapState.amountIn).toBe('');
        expect(data.swapState.selectedQuote).toBeNull();
    });

    test('replaces unavailable tokens with distinct available defaults', () => {
        localStorage.setItem(storageKey, JSON.stringify({
            tokenIn: 'removed.near', tokenOut: 'NEAR',
        }));
        render(tokenConfig([near, usdt]));
        expect(data.swapState.tokenIn).toBe(near);
        expect(data.swapState.tokenOut).toBe(usdt);
    });

    test('ignores corrupt storage and pairs saved for another network', () => {
        localStorage.setItem(storageKey, '{invalid');
        localStorage.setItem('swapTokenPair:testnet', JSON.stringify({
            tokenIn: 'usdc.near', tokenOut: 'NEAR',
        }));
        render(tokenConfig([near, usdt, usdc]));
        expect(data.swapState.tokenIn).toBe(near);
        expect(data.swapState.tokenOut).toBe(usdt);
    });

    test('allows changing tokens when browser storage is blocked', () => {
        jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
            throw new Error('Storage blocked');
        });
        jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
            throw new Error('Storage blocked');
        });
        render(tokenConfig([near, usdt, usdc]));
        act(() => {
            data.events.setTokenOut(usdc);
        });
        expect(data.swapState.tokenOut).toBe(usdc);
    });
});
