import React from 'react';
import ReactDOM from 'react-dom';
import { act } from 'react-dom/test-utils';

import RecoverableBalances from './RecoverableBalances';
import fungibleTokenExchange from '../../../services/tokenExchange';

const mockDispatch = jest.fn();

jest.mock('react-redux', () => ({ useDispatch: () => mockDispatch }));
jest.mock('../../../config', () => ({
    __esModule: true,
    default: { IS_MAINNET: true },
}));
jest.mock('../../../redux/actions/status', () => ({ showCustomAlert: jest.fn() }));
jest.mock('../../../redux/slices/swap', () => ({
    actions: { updateTokensBalance: jest.fn() },
}));
jest.mock('../../../services/tokenExchange', () => ({
    __esModule: true,
    default: {
        getRecoverableBalances: jest.fn(),
        withdraw: jest.fn(),
        checkWithdrawalResult: jest.fn(),
    },
}));
jest.mock('../../../utils/gasPrice', () => ({ getTotalGasFee: jest.fn() }));
jest.mock('../../../utils/window', () => ({ openTransactionInExplorer: jest.fn() }));

describe('recoverable swap balances', () => {
    let root;

    beforeEach(() => {
        root = document.createElement('div');
        document.body.appendChild(root);
        mockDispatch.mockClear();
        fungibleTokenExchange.withdraw.mockClear();
        fungibleTokenExchange.getRecoverableBalances.mockResolvedValue([
            { tokenId: 'usdc.near', amount: '100', metadata: null },
        ]);
        fungibleTokenExchange.withdraw.mockResolvedValue({
            success: false,
            unconfirmed: true,
            swapTxHash: 'pending-hash',
        });
        fungibleTokenExchange.checkWithdrawalResult.mockResolvedValue({
            success: false,
            unconfirmed: false,
            failReason: 'Failed on chain',
        });
    });

    afterEach(() => {
        act(() => {
            ReactDOM.unmountComponentAtNode(root);
        });
        root.remove();
    });

    test('locks an unconfirmed withdrawal until a terminal status is checked', async () => {
        await act(async () => {
            ReactDOM.render(
                <RecoverableBalances account={{ accountId: 'alice.near' }} />,
                root
            );
        });

        const button = (label) =>
            [...root.querySelectorAll('button')].find(
                (element) => element.textContent === label
            );

        await act(async () => {
            button('Withdraw').click();
        });
        expect(button('Withdraw').disabled).toBe(true);
        expect(button('Check status')).not.toBeNull();

        await act(async () => {
            button('Check status').click();
        });
        expect(fungibleTokenExchange.checkWithdrawalResult).toHaveBeenCalledWith({
            account: { accountId: 'alice.near' },
            hash: 'pending-hash',
            tokenId: 'usdc.near',
        });
        expect(button('Withdraw').disabled).toBe(false);
        expect(root.textContent).toContain('Failed on chain');
    });

    test('shows a 24-decimal balance without rounding it to zero', async () => {
        fungibleTokenExchange.getRecoverableBalances.mockResolvedValue([
            {
                tokenId: 'tiny.near',
                amount: '1',
                metadata: { symbol: 'TINY', decimals: 24 },
            },
        ]);

        await act(async () => {
            ReactDOM.render(
                <RecoverableBalances account={{ accountId: 'alice.near' }} />,
                root
            );
        });

        expect(root.textContent).toContain('0.000000000000000000000001 TINY');
    });

    test('keeps an unknown withdrawal without a hash locked and describes the uncertainty', async () => {
        fungibleTokenExchange.withdraw.mockResolvedValue({
            success: false,
            unconfirmed: true,
            swapTxHash: '',
        });
        await act(async () => {
            ReactDOM.render(
                <RecoverableBalances account={{ accountId: 'alice.near' }} />,
                root
            );
        });

        const withdrawButton = [...root.querySelectorAll('button')].find(
            (element) => element.textContent === 'Withdraw'
        );
        await act(async () => {
            withdrawButton.click();
        });

        expect(withdrawButton.disabled).toBe(true);
        expect(root.textContent).toContain(
            'Withdrawal status unknown. Check your account activity'
        );
        expect(root.textContent).not.toContain('Withdrawal submitted');
        expect(root.textContent).not.toContain('Check status');
        await act(async () => {
            withdrawButton.click();
        });
        expect(fungibleTokenExchange.withdraw).toHaveBeenCalledTimes(1);
    });
});
