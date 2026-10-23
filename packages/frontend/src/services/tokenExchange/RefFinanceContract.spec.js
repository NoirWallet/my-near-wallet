import { RefFinanceContract } from './RefFinanceContract';

jest.mock('../../config', () => ({
    __esModule: true,
    default: { REF_FINANCE_CONTRACT: 'v2.ref-finance.near' },
}));
jest.mock('../../utils/gasPrice', () => ({ getTotalGasFee: jest.fn() }));

test('Ref quotes use contract get_return integers and tolerate one failed candidate', async () => {
    const account = {
        viewFunction: jest.fn(async (_, method, args) => {
            if (method === 'get_return') {
                if (args.pool_id === 2) {
                    throw new Error('Stale pool');
                }
                return args.pool_id === 0
                    ? '999999999999999999999999'
                    : '1000000000000000000000000';
            }
            return {
                token_account_ids: ['a.near', 'b.near'],
                amounts: ['1000000000000000000000000000', '1000000000000000000000000000'],
                total_fee: 30,
            };
        }),
    };
    const quote = await new RefFinanceContract().estimate({
        account,
        tokenInId: 'a.near',
        tokenOutId: 'b.near',
        tokenInDecimals: 24,
        tokenOutDecimals: 24,
        amountIn: '1.000000000000000000000001',
        poolsByIds: { 0: { poolId: 0 }, 1: { poolId: 1 }, 2: { poolId: 2 } },
    });
    expect(quote.poolId).toBe(1);
    expect(quote.amountOutRaw).toBe('1000000000000000000000000');
    expect(account.viewFunction.mock.calls[0][2].amount_in).toBe(
        '1000000000000000000000001'
    );
    expect(account.viewFunction).toHaveBeenCalledWith('v2.ref-finance.near', 'get_pool', {
        pool_id: 1,
    });
});
