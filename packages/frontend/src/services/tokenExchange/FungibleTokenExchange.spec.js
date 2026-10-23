import { FungibleTokenExchange } from './FungibleTokenExchange';
import { createQuoteContext } from './quotes';

jest.mock('./SmartRouterV2', () => ({ __esModule: true, default: {} }));
jest.mock('./RefFinanceContract', () => ({ __esModule: true, default: {} }));
jest.mock('../../redux/slices/sign/transactionExecutor', () => ({
    dispatchTransactionsExecutor: jest.fn(),
}));
jest.mock('../../utils/gasPrice', () => ({ getTotalGasFee: jest.fn() }));
jest.mock('../../config', () => ({
    __esModule: true,
    default: {
        CURRENT_NEAR_NETWORK: 'mainnet',
        NEAR_ID: 'NEAR',
        NEAR_TOKEN_ID: 'wrap.near',
        FT_STORAGE_DEPOSIT_GAS: '30000000000000',
    },
}));

const token = (contractName, decimals = 6) => ({
    contractName,
    onChainFTMetadata: { decimals },
});
const params = () => ({
    account: {
        accountId: 'alice.near',
        viewFunction: jest.fn().mockResolvedValue({ total: '1' }),
    },
    tokenIn: token('a.near'),
    tokenOut: token('b.near'),
    amountIn: '1',
    slippage: 1,
});
const makeQuote = (request, source = 'v2', changes = {}) => ({
    source,
    context: createQuoteContext(request),
    amountOutRaw: '1000000',
    minAmountOutRaw: '990000',
    amountOut: '1',
    minAmountOut: '0.99',
    outputDecimals: 6,
    priceImpactPercent: '0',
    estimatedFee: '0.001',
    swapFee: null,
    transactions: [],
    registrationKey: '',
    routeTokenIds: ['a.near', 'b.near'],
    execution: { msg: 'opaque', signature: 'signed' },
    ...changes,
});

describe('swap source selection and execution boundary', () => {
    let exchangeContract, router, execute, service;
    beforeEach(() => {
        exchangeContract = {
            estimate: jest.fn().mockResolvedValue({
                amountOutRaw: '900000',
                amountOut: '0.9',
                poolId: 0,
                swapFee: '0.3',
                priceImpactPercent: '1',
            }),
            getSwapActions: jest.fn().mockResolvedValue([]),
        };
        router = {
            getQuote: jest.fn(),
            interpretResult: jest
                .fn()
                .mockReturnValue({ success: true, amountOutRaw: '999999' }),
        };
        execute = jest
            .fn()
            .mockResolvedValue({ success: true, txHash: 'hash', data: [] });
        service = new FungibleTokenExchange({
            exchangeContract,
            router,
            execute,
            estimateFee: async () => '0.001',
        });
    });

    test('uses V2 when no direct Ref quote exists and keeps Ref when V2 fails', async () => {
        const request = params();
        exchangeContract.estimate.mockRejectedValueOnce(new Error('No pool'));
        router.getQuote.mockResolvedValueOnce(makeQuote(request));
        expect((await service.estimate(request)).source).toBe('v2');
        router.getQuote.mockRejectedValueOnce(new Error('Missing prices'));
        expect((await service.estimate(request)).source).toBe('ref');
    });

    test('compares fresh net outputs and only errors when both sources fail', async () => {
        const request = params();
        router.getQuote.mockResolvedValue(makeQuote(request));
        expect((await service.estimate(request)).source).toBe('v2');
        exchangeContract.estimate.mockRejectedValue(new Error('RPC down'));
        router.getQuote.mockRejectedValue(new Error('API down'));
        await expect(service.estimate(request)).rejects.toThrow('No swap quote');
    });

    test('stops an obsolete RPC response from becoming a selected quote', async () => {
        const request = params();
        const controller = new AbortController();
        exchangeContract.estimate.mockImplementation(() => new Promise(() => {}));
        router.getQuote.mockImplementation(() => new Promise(() => {}));
        const pending = service.estimate({ ...request, signal: controller.signal });
        controller.abort();
        await expect(pending).rejects.toThrow('cancelled');
    });

    test('requires another review before signing a quote with a lower minimum', async () => {
        const request = params();
        const quote = makeQuote(request);
        router.getQuote.mockResolvedValue({ ...quote, minAmountOutRaw: '980000' });
        const result = await service.swap({ ...request, quote });
        expect(result.reviewRequired).toBe(true);
        expect(execute).not.toHaveBeenCalled();
    });

    test('refuses changed account/input before and after refreshing', async () => {
        const request = params();
        const quote = makeQuote(request);
        await expect(service.swap({ ...request, amountIn: '2', quote })).rejects.toThrow(
            'changed'
        );
        let current = true;
        router.getQuote.mockImplementation(async () => {
            current = false;
            return quote;
        });
        await expect(
            service.swap({ ...request, quote, isCurrent: () => current })
        ).rejects.toThrow('changed');
        expect(execute).not.toHaveBeenCalled();
    });

    test('executes only the refreshed selected source and reports the actual payout', async () => {
        const request = params();
        const quote = makeQuote(request);
        router.getQuote.mockResolvedValue(quote);
        const result = await service.swap({ ...request, quote });
        expect(result).toMatchObject({
            success: true,
            swapTxHash: 'hash',
            amountOut: '0.999999',
        });
        expect(exchangeContract.estimate).not.toHaveBeenCalled();
        expect(execute).toHaveBeenCalledTimes(1);
    });

    test('NEAR and wNEAR conversions stay direct and do not request a DEX quote', async () => {
        const request = {
            ...params(),
            tokenIn: token('NEAR', 24),
            tokenOut: token('wrap.near', 24),
        };
        const quote = await service.estimate(request);
        expect(quote.source).toBe('wrap');
        expect(quote.minAmountOut).toBe('1');
        expect(quote.transactions[0].actions[0].functionCall.methodName).toBe(
            'near_deposit'
        );
        expect(router.getQuote).not.toHaveBeenCalled();
        expect(exchangeContract.estimate).not.toHaveBeenCalled();
    });

    test('retains unknown submission status and distinguishes a completed preparation from a submitted swap', async () => {
        const request = params();
        const quote = makeQuote(request, 'v2', {
            transactions: [
                { receiverId: 'a.near', actions: [] },
                { receiverId: 'a.near', actions: [] },
            ],
        });
        router.getQuote.mockResolvedValue(quote);
        execute.mockResolvedValue({
            success: false,
            unconfirmed: true,
            txHash: 'preparation-hash',
            transactionIndex: 0,
        });
        const pending = await service.swap({ ...request, quote });
        expect(pending).toMatchObject({
            success: false,
            unconfirmed: true,
            swapTxHash: 'preparation-hash',
        });
        request.account.connection = {
            provider: {
                txStatus: jest.fn().mockResolvedValue({
                    status: { SuccessValue: '' },
                    receipts_outcome: [],
                }),
            },
        };
        const checked = await service.checkSwapResult({
            account: request.account,
            quote: pending.quote,
            hash: pending.swapTxHash,
        });
        expect(checked).toMatchObject({ success: false, unconfirmed: false });
        expect(checked.failReason).toContain('swap was not submitted');
    });

    test('status lookup keeps a non-final withdrawal unconfirmed', async () => {
        const { account } = params();
        account.connection = {
            provider: {
                txStatus: jest
                    .fn()
                    .mockResolvedValue({ status: 'Started', receipts_outcome: [] }),
            },
        };
        expect(
            await service.checkWithdrawalResult({
                account,
                tokenId: 'wrap.near',
                hash: 'hash',
            })
        ).toMatchObject({ success: false, unconfirmed: true });
    });

    test.each(['ref', 'wrap'])(
        'does not report a partially submitted %s plan as a completed swap',
        async (source) => {
            const request = params();
            const quote = makeQuote(request, source, {
                transactions: [
                    { receiverId: 'a.near', actions: [] },
                    { receiverId: 'b.near', actions: [] },
                ],
            });
            const pending = service._formatResult(
                { unconfirmed: true, transactionIndex: 0, txHash: 'preparation-hash' },
                quote
            );
            request.account.connection = {
                provider: {
                    txStatus: jest.fn().mockResolvedValue({
                        status: { SuccessValue: '' },
                        receipts_outcome: [],
                    }),
                },
            };
            const result = await service.checkSwapResult({
                account: request.account,
                quote: pending.quote,
                hash: pending.swapTxHash,
            });
            expect(result).toMatchObject({ success: false, unconfirmed: false });
            expect(result.failReason).toContain('Only part');
        }
    );

    test('a confirmed storage deposit does not confirm an unsubmitted withdrawal', async () => {
        const { account } = params();
        account.connection = {
            provider: {
                txStatus: jest.fn().mockResolvedValue({
                    status: { SuccessValue: '' },
                    receipts_outcome: [],
                    transaction: {
                        actions: [{ FunctionCall: { method_name: 'storage_deposit' } }],
                    },
                }),
            },
        };
        const result = await service.checkWithdrawalResult({
            account,
            tokenId: 'wrap.near',
            hash: 'preparation-hash',
        });
        expect(result).toMatchObject({ success: false, unconfirmed: false });
        expect(result.failReason).toContain('No withdrawal was submitted');
        expect(router.interpretResult).not.toHaveBeenCalled();
    });
});
