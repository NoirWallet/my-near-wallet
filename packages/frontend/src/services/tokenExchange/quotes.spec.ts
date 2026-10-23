import { transactions } from 'near-api-js';
import { describe, expect, jest, test } from '@jest/globals';

import {
    fromRaw,
    getTransactionFee,
    getUsdPriceImpact,
    requiresQuoteReview,
    selectBestQuote,
    SwapQuote,
    toRaw,
} from './quotes';

jest.mock('../../utils/gasPrice', () => ({
    getTotalGasFee: async (gas) => (BigInt(gas) * 100000000n).toString(),
}));

const context = {
    accountId: 'alice.near',
    tokenInId: 'a.near',
    tokenOutId: 'b.near',
    amountIn: '100',
    slippage: '1',
};
const quote = (
    source: SwapQuote['source'],
    output = '100000000000000000000001'
): SwapQuote => ({
    source,
    context,
    amountOutRaw: output,
    minAmountOutRaw: '99',
    amountOut: '100',
    minAmountOut: '99',
    outputDecimals: 0,
    priceImpactPercent: '1',
    swapFee: null,
    estimatedFee: '0.001',
    transactions: [],
    registrationKey: '',
    routeTokenIds: ['a.near', 'b.near'],
    execution: {},
});

describe('swap quote arithmetic and review', () => {
    test('compares every smallest unit and prefers Ref on ties regardless of order', () => {
        const ref = quote('ref');
        const v2 = quote('v2', '100000000000000000000002');
        expect(selectBestQuote([ref, v2])).toBe(v2);
        expect(selectBestQuote([quote('v2'), ref])).toBe(ref);
        expect(selectBestQuote([ref, quote('v2')])).toBe(ref);
    });

    test('does not compare quotes bound to different accounts', () => {
        expect(() =>
            selectBestQuote([
                quote('ref'),
                { ...quote('v2'), context: { ...context, accountId: 'bob.near' } },
            ])
        ).toThrow();
    });

    test('preserves raw precision and rejects amounts that would round up', () => {
        expect(toRaw('1.000000000000000000000001', 24)).toBe('1000000000000000000000001');
        expect(fromRaw('1000000000000000000000001', 24)).toBe(
            '1.000000000000000000000001'
        );
        expect(() => toRaw('0.0000001', 6)).toThrow('precision');
        expect(() => toRaw('-1', 24)).toThrow();
    });

    test('uses USD value with exact warning and blocking boundaries', () => {
        const impact = (amountOut: string) =>
            getUsdPriceImpact({
                amountIn: '100',
                amountOut,
                priceIn: '1',
                priceOut: '1',
            });
        expect(impact('98')).toBe('2');
        expect(impact('94')).toBe('6');
        expect(Number(impact('93.999999'))).toBeGreaterThan(6);
        expect(impact('102')).toBe('0');
        expect(
            getUsdPriceImpact({
                amountIn: '2',
                amountOut: '3.92',
                priceIn: '2',
                priceOut: '1',
            })
        ).toBe('2');
        [undefined, 0].forEach((price) => {
            expect(() =>
                getUsdPriceImpact({
                    amountIn: '1',
                    amountOut: '1',
                    priceIn: price,
                    priceOut: 1,
                })
            ).toThrow();
        });
    });

    test('requires confirmation for lower minimum, greater fee or changed registration scope', () => {
        const previous = quote('v2');
        expect(requiresQuoteReview(previous, { ...previous })).toBe(false);
        expect(
            requiresQuoteReview(previous, {
                ...previous,
                amountOutRaw: '200',
                minAmountOutRaw: '100',
                estimatedFee: '0.0009',
            })
        ).toBe(false);
        expect(
            requiresQuoteReview(previous, { ...previous, minAmountOutRaw: '98' })
        ).toBe(true);
        expect(
            requiresQuoteReview(previous, {
                ...previous,
                estimatedFee: '0.001000000000000000000001',
            })
        ).toBe(true);
        expect(
            requiresQuoteReview(previous, { ...previous, registrationKey: 'a.near' })
        ).toBe(true);
        expect(
            requiresQuoteReview(previous, { ...previous, priceImpactPercent: '6.0001' })
        ).toBe(true);
    });

    test('estimates actual planned gas and storage deposits, excluding native input principal', async () => {
        const txs = [
            {
                receiverId: 'wrap.near',
                actions: [
                    transactions.functionCall(
                        'storage_deposit',
                        {},
                        '30000000000000',
                        '1250000000000000000000'
                    ),
                    transactions.functionCall(
                        'near_deposit',
                        {},
                        '30000000000000',
                        '1000000000000000000000000'
                    ),
                    transactions.functionCall(
                        'ft_transfer_call',
                        {},
                        '600000000000000',
                        '1'
                    ),
                ],
            },
        ];
        expect(
            await getTransactionFee(null, txs, {
                nativePrincipalRaw: '1000000000000000000000000',
            })
        ).toBe('0.067250000000000000000001');
    });
});
