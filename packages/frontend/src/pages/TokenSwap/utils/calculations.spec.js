import { getSwapFeeAmount } from './calculations';

jest.mock('../../../config', () => ({
    __esModule: true,
    default: {},
}));
jest.mock('../../../utils/gasPrice', () => ({ getTotalGasFee: jest.fn() }));

describe('getSwapFeeAmount', () => {
    test('omits an unavailable V2 swap fee', () => {
        expect(getSwapFeeAmount({ amountIn: '100', swapFee: null })).toBe(0);
        expect(getSwapFeeAmount({ amountIn: '100' })).toBe(0);
        expect(getSwapFeeAmount({ amountIn: '100', swapFee: NaN })).toBe(0);
        expect(getSwapFeeAmount({ amountIn: '100', swapFee: Infinity })).toBe(0);
    });

    test('calculates a Ref percentage supplied as a string', () => {
        expect(getSwapFeeAmount({ amountIn: '100', swapFee: '0.3' })).toBe(0.3);
    });
});
