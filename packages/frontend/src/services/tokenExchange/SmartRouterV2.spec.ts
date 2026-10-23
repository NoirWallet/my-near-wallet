import { beforeEach, expect, jest, test } from '@jest/globals';

import SmartRouterV2 from './SmartRouterV2';
import type { SwapQuote } from './quotes';

jest.mock('../../config', () => ({
    __esModule: true,
    default: { NEAR_ID: 'NEAR', NEAR_TOKEN_ID: 'wrap.near' },
}));
jest.mock('../../utils/fiatValueManager', () => ({
    fiatValueManager: {
        fetchRefFinancePrices: jest.fn(async () => ({
            near: { usd: 5 },
            'wrap.near': { usd: 5 },
            'usdt.tether-token.near': { usd: 1 },
        })),
    },
}));
jest.mock('../../utils/gasPrice', () => ({ getTotalGasFee: jest.fn() }));
jest.mock('./quotes', () => ({
    ...jest.requireActual<typeof import('./quotes')>('./quotes'),
    getTransactionFee: jest.fn(async () => '0.01'),
}));

const amountIn = '1000000000000000000000';
const input = { contractName: 'NEAR', onChainFTMetadata: { decimals: 24 } };
const output = {
    contractName: 'usdt.tether-token.near',
    onChainFTMetadata: { decimals: 6 },
};

function routerData(tokens = ['wrap.near', 'usdt.tether-token.near']) {
    return {
        result_code: 0,
        result_data: {
            amount_in: amountIn,
            amount_out: '5000',
            min_amount_out: '4975',
            msg: 'opaque-message',
            signature: 'opaque-signature',
            tokens,
        },
    };
}

function account(view?: (contract: string, method: string, args: any) => unknown) {
    return {
        accountId: 'example.near',
        viewFunction: jest.fn(async (contract: string, method: string, args: any) => {
            if (view) {
                return view(contract, method, args);
            }
            if (method === 'storage_balance_of') {
                return { total: '1250000000000000000000' };
            }
            if (method === 'query_user_tokens_registered') {
                return args.tokens.map(() => true);
            }
            if (method === 'storage_balance_bounds') {
                return { min: '1250000000000000000000' };
            }
            throw new Error(`Unexpected view ${method}`);
        }),
    } as unknown as Wallet.Account;
}

function request(wallet = account()) {
    return {
        account: wallet,
        tokenIn: input as Wallet.Token,
        tokenOut: output as Wallet.Token,
        amountIn: '0.001',
        slippage: 0.5,
    };
}

function action(tx: any) {
    return tx.actions[0].functionCall;
}

function args(tx: any) {
    return JSON.parse(Buffer.from(action(tx).args).toString('utf8'));
}

beforeEach(() => {
    jest.clearAllMocks();
    globalThis.fetch = jest.fn(async () => ({
        ok: true,
        json: async () => routerData(),
    })) as any;
});

test('requests a bound quote and keeps the signed payload opaque through execution', async () => {
    const quote = await SmartRouterV2.getQuote(request());
    const [url] = (fetch as any).mock.calls[0];
    const params = new URL(url).searchParams;
    expect(params.get('amountIn')).toBe(amountIn);
    expect(params.get('tokenIn')).toBe('wrap.near');
    expect(params.get('tokenOut')).toBe('usdt.tether-token.near');
    expect(params.get('slippage')).toBe('0.005');
    expect(params.get('user')).toBe('example.near');
    expect(params.get('receiveUser')).toBe('example.near');
    expect(params.get('skipUnwrapNativeToken')).toBe('false');
    expect(params.get('chainId')).toBe('0');
    expect(params.get('pathDeep')).toBe('3');
    expect(quote.amountOutRaw).toBe('5000');
    expect(quote.minAmountOutRaw).toBe('4975');
    expect(quote.amountOut).toBe('0.005');
    expect(quote.transactions.map((tx) => action(tx).methodName)).toEqual([
        'near_deposit',
        'ft_transfer_call',
    ]);
    expect(action(quote.transactions[1]).gas.toString()).toBe('600000000000000');
    expect(args(quote.transactions[1])).toEqual({
        receiver_id: 'aggregatedex.near',
        amount: amountIn,
        msg: JSON.stringify({ msg: 'opaque-message', signature: 'opaque-signature' }),
    });
});

test('registers only missing token and internal balances for every route token', async () => {
    globalThis.fetch = jest.fn(async () => ({
        ok: true,
        json: async () => routerData(['wrap.near', 'mid.near', 'usdt.tether-token.near']),
    })) as any;
    const wallet = account((_contract, method, argsValue) => {
        if (method === 'storage_balance_of') {
            if (
                argsValue.account_id === 'example.near' &&
                _contract === 'usdt.tether-token.near'
            ) {
                return null;
            }
            if (
                argsValue.account_id === 'aggregatedex.near' &&
                _contract === 'mid.near'
            ) {
                return null;
            }
            return { total: '1250000000000000000000' };
        }
        if (method === 'storage_balance_bounds') {
            return { min: '1250000000000000000000' };
        }
        if (method === 'query_user_tokens_registered') {
            return argsValue.tokens.map((tokenId: string) => tokenId !== 'mid.near');
        }
        throw new Error(`Unexpected view ${method}`);
    });
    const quote = await SmartRouterV2.getQuote(request(wallet));
    expect(quote.routeTokenIds).toEqual([
        'mid.near',
        'usdt.tether-token.near',
        'wrap.near',
    ]);
    expect(quote.registrationKey.split('|')).toEqual([
        'ft:aggregatedex.near:mid.near',
        'ft:example.near:usdt.tether-token.near',
        'internal:example.near:mid.near',
    ]);
    expect(quote.transactions.map((tx) => action(tx).methodName)).toEqual([
        'storage_deposit',
        'storage_deposit',
        'tokens_storage_deposit',
        'near_deposit',
        'ft_transfer_call',
    ]);
    expect(args(quote.transactions[2])).toEqual({
        user: 'example.near',
        tokens: ['mid.near'],
    });
    expect(action(quote.transactions[2]).deposit.toString()).toBe(
        '5000000000000000000000'
    );
});

test('rejects a quote whose response does not match the requested amount or route', async () => {
    const wallet = account();
    globalThis.fetch = jest.fn(async () => ({
        ok: true,
        json: async () => ({
            ...routerData(),
            result_data: { ...routerData().result_data, amount_in: '2' },
        }),
    })) as any;
    await expect(SmartRouterV2.getQuote(request(wallet))).rejects.toThrow(
        'Invalid SmartRouter V2 quote'
    );
    expect((wallet.viewFunction as any).mock.calls).toHaveLength(0);
});

test.each([
    [
        {
            ...routerData(),
            result_data: { ...routerData().result_data, min_amount_out: '4974' },
        },
        'Invalid SmartRouter V2 quote',
    ],
    [
        {
            ...routerData(),
            result_data: { ...routerData().result_data, tokens: ['wrap.near'] },
        },
        'Invalid SmartRouter V2 route',
    ],
    [{ result_code: 1008, result_message: 'No path' }, 'No path'],
])(
    'rejects an invalid or unavailable API quote before registration',
    async (response, message) => {
        const wallet = account();
        globalThis.fetch = jest.fn(async () => ({
            ok: true,
            json: async () => response,
        })) as any;
        await expect(SmartRouterV2.getQuote(request(wallet))).rejects.toThrow(message);
        expect((wallet.viewFunction as any).mock.calls).toHaveLength(0);
    }
);

test('cancels before fetch and after an in-flight registration response', async () => {
    const early = new AbortController();
    early.abort();
    await expect(
        SmartRouterV2.getQuote({ ...request(), signal: early.signal })
    ).rejects.toMatchObject({
        name: 'AbortError',
    });
    expect(fetch).not.toHaveBeenCalled();

    const delayed = new AbortController();
    const wallet = account(() => {
        delayed.abort();
        return { total: '1250000000000000000000' };
    });
    await expect(
        SmartRouterV2.getQuote({ ...request(wallet), signal: delayed.signal })
    ).rejects.toMatchObject({
        name: 'AbortError',
    });
    expect((wallet.viewFunction as any).mock.calls).toHaveLength(1);
});

test('times out an unresponsive router request', async () => {
    jest.useFakeTimers();
    try {
        globalThis.fetch = jest.fn(
            (_url, options: any) =>
                new Promise((_resolve, reject) => {
                    options.signal.addEventListener('abort', () =>
                        reject(new DOMException('aborted', 'AbortError'))
                    );
                })
        ) as any;
        const pending = SmartRouterV2.getQuote(request());
        jest.advanceTimersByTime(5000);
        await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    } finally {
        jest.useRealTimers();
    }
});

test('excludes a quote when the shared USD price is unavailable', async () => {
    const { fiatValueManager } = jest.requireMock<
        typeof import('../../utils/fiatValueManager')
    >('../../utils/fiatValueManager');
    (
        fiatValueManager.fetchRefFinancePrices as jest.Mock<() => Promise<any>>
    ).mockResolvedValueOnce({
        near: { usd: 5 },
    });
    await expect(SmartRouterV2.getQuote(request())).rejects.toThrow(
        'Token prices unavailable'
    );
});

test('keeps positive internal balances even when token metadata fails and prepares registered withdrawal', async () => {
    const wallet = account((contract, method) => {
        if (method === 'query_user_exist_balance') {
            return [
                ['usdt.tether-token.near', 'wrap.near'],
                ['0', '100'],
            ];
        }
        if (method === 'ft_metadata') {
            throw new Error('metadata unavailable');
        }
        if (method === 'storage_balance_of') {
            return null;
        }
        if (method === 'storage_balance_bounds') {
            return { min: '1250000000000000000000' };
        }
        throw new Error(`Unexpected view ${contract}:${method}`);
    });
    await expect(SmartRouterV2.getBalances(wallet)).resolves.toEqual([
        { tokenId: 'wrap.near', amount: '100', metadata: null },
    ]);
    const txs = await SmartRouterV2.getWithdrawalTransactions({
        account: wallet,
        tokenId: 'wrap.near',
    });
    expect(txs.map((tx) => action(tx).methodName)).toEqual([
        'storage_deposit',
        'withdraw',
    ]);
    expect(args(txs[1])).toEqual({ token: 'wrap.near', return_near: false });
    expect(action(txs[1]).gas.toString()).toBe('300000000000000');
});

test('requires target delivery and rejects aggregator refund events despite successful receipts', () => {
    const quote = {
        context: { accountId: 'example.near', tokenOutId: 'usdt.tether-token.near' },
        minAmountOutRaw: '4975',
    } as SwapQuote;
    const event = (name: string, data: object[]) =>
        `EVENT_JSON:${JSON.stringify({ event: name, data })}`;
    const delivered = event('withdraw_succeeded', [
        {
            token_id: 'usdt.tether-token.near',
            receive_id: 'example.near',
            amount: '5000',
        },
    ]);
    const outcome = (logs: string[]) => ({
        success: true,
        data: [
            {
                status: { SuccessValue: '' },
                receipts_outcome: [
                    {
                        outcome: {
                            executor_id: 'aggregatedex.near',
                            status: { SuccessValue: '' },
                            logs,
                        },
                    },
                ],
            },
        ],
    });
    expect(
        SmartRouterV2.interpretResult({ result: outcome([delivered]), quote })
    ).toEqual({
        success: true,
        amountOutRaw: '5000',
    });
    expect(
        SmartRouterV2.interpretResult({
            result: outcome([
                event('swap_failed_refund_started', [
                    { token_id: 'usdt.tether-token.near' },
                ]),
                delivered,
            ]),
            quote,
        })
    ).toEqual({
        success: false,
        failReason: 'SmartRouter V2 swap failed or refunded',
    });
    expect(SmartRouterV2.interpretResult({ result: outcome([]), quote })).toEqual({
        success: false,
        unconfirmed: true,
    });
    expect(
        SmartRouterV2.interpretResult({
            result: outcome([
                event('withdraw_succeeded', [
                    {
                        token_id: 'usdt.tether-token.near',
                        user_id: 'example.near',
                        amount: '5000',
                    },
                ]),
            ]),
            quote,
        })
    ).toEqual({ success: true, amountOutRaw: '5000' });
});
