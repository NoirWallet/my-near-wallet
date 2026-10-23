import { beforeEach, expect, jest, test } from '@jest/globals';

import { handleTransactionsExecutor } from './transactionExecutor';
import { wallet } from '../../../utils/wallet';

jest.mock('../../../utils/wallet', () => ({ wallet: { getAccount: jest.fn() } }));
jest.mock('../../..', () => ({ store: { dispatch: jest.fn() } }));
jest.mock('../account', () => ({ selectAccountId: (state) => state.accountId }));
jest.mock('../ledger', () => ({
    actions: {},
    selectLedgerConnectionAvailable: () => true,
    selectLedgerHasLedger: () => false,
}));

const txs = [
    { receiverId: 'wrap.near', actions: [] },
    { receiverId: 'token.near', actions: [] },
];
const outcome = (hash: string, failed = false) => ({
    status: { SuccessValue: '' },
    transaction: { hash },
    receipts_outcome: [
        {
            outcome: {
                status: failed ? { Failure: { error: 'failed' } } : { SuccessValue: '' },
            },
        },
    ],
});

beforeEach(() => jest.clearAllMocks());

test('retains all available receipts when a transaction fails', async () => {
    const failed = outcome('failed-hash', true);
    const signAndSendTransaction = jest
        .fn<() => Promise<any>>()
        .mockResolvedValue(failed);
    (wallet.getAccount as jest.Mock<() => Promise<any>>).mockResolvedValue({
        signAndSendTransaction,
    });
    const action = await handleTransactionsExecutor({ txs, accountId: 'alice.near' })(
        jest.fn(),
        () => ({ accountId: 'alice.near' }),
        undefined
    );
    expect(action.payload).toMatchObject({
        success: false,
        txHash: 'failed-hash',
        data: [failed],
    });
    expect(signAndSendTransaction).toHaveBeenCalledTimes(1);
    expect(signAndSendTransaction).toHaveBeenCalledWith({ ...txs[0], returnError: true });
});

test('stops remaining transactions when the active account changes', async () => {
    let accountId = 'alice.near';
    const first = outcome('first-hash');
    const signAndSendTransaction = jest
        .fn<() => Promise<any>>()
        .mockImplementation(async () => {
            accountId = 'bob.near';
            return first;
        });
    (wallet.getAccount as jest.Mock<() => Promise<any>>).mockResolvedValue({
        signAndSendTransaction,
    });
    const action = await handleTransactionsExecutor({
        txs,
        accountId,
        shouldContinue: () => true,
    })(jest.fn(), () => ({ accountId }), undefined);
    expect(action.payload).toMatchObject({
        success: false,
        txHash: 'first-hash',
        data: [first],
    });
    expect(signAndSendTransaction).toHaveBeenCalledTimes(1);
});

test('preserves the signed hash when the broadcast response is unknown', async () => {
    const signAndSendTransaction = jest
        .fn<() => Promise<any>>()
        .mockRejectedValue({ context: { transactionHash: 'swap-hash' } });
    (wallet.getAccount as jest.Mock<() => Promise<any>>).mockResolvedValue({
        signAndSendTransaction,
    });
    const action = await handleTransactionsExecutor({ txs, accountId: 'alice.near' })(
        jest.fn(),
        () => ({ accountId: 'alice.near' }),
        undefined
    );
    expect(action.payload).toMatchObject({
        success: false,
        unconfirmed: true,
        txHash: 'swap-hash',
    });
    expect(signAndSendTransaction).toHaveBeenCalledTimes(1);
});
