import Big from 'big.js';
import { transactions } from 'near-api-js';

import refFinanceContract from './RefFinanceContract';
import smartRouterV2 from './SmartRouterV2';
import {
    createQuoteContext,
    fromRaw,
    getTransactionFee,
    requiresQuoteReview,
    sameQuoteContext,
    selectBestQuote,
} from './quotes';
import CONFIG from '../../config';
import { dispatchTransactionsExecutor } from '../../redux/slices/sign/transactionExecutor';

export class FungibleTokenExchange {
    constructor({
        exchangeContract = refFinanceContract,
        router = smartRouterV2,
        execute = dispatchTransactionsExecutor,
        estimateFee = getTransactionFee,
    } = {}) {
        this._exchangeContract = exchangeContract;
        this._router = router;
        this._execute = execute;
        this._estimateFee = estimateFee;
    }

    async getData({ account }) {
        return this._exchangeContract.getData({ account });
    }

    async estimate(params) {
        const context = createQuoteContext(params);
        if (this.isNearTransformation(params)) {
            return this._getWrapQuote({ ...params, context });
        }
        const sources = ['ref'];
        if (CONFIG.CURRENT_NEAR_NETWORK === 'mainnet') {
            sources.push('v2');
        }
        const results = await Promise.allSettled(
            sources.map((source) => this._getSourceQuote(source, { ...params, context }))
        );
        if (params.signal?.aborted) {
            throw new Error('Quote request cancelled');
        }
        return selectBestQuote(
            results
                .filter((result) => result.status === 'fulfilled')
                .map((result) => result.value)
        );
    }

    // Timeout also bounds non-cancellable RPC views; their late replies cannot select a quote.
    async _getSourceQuote(source, params) {
        if (
            !['ref', 'v2'].includes(source) ||
            (source === 'v2' && CONFIG.CURRENT_NEAR_NETWORK !== 'mainnet')
        ) {
            throw new Error('Swap source unavailable on this network');
        }
        const controller = new AbortController();
        const cancel = () => controller.abort();
        params.signal?.addEventListener('abort', cancel, { once: true });
        if (params.signal?.aborted) {
            controller.abort();
        }
        let onAbort;
        const aborted = new Promise((_, reject) => {
            onAbort = () => reject(new Error('Swap quote expired or cancelled'));
            controller.signal.addEventListener('abort', onAbort, { once: true });
            if (controller.signal.aborted) {
                onAbort();
            }
        });
        // The router HTTP request has its own five-second deadline. Allow time for
        // the subsequent on-chain storage and fee checks that form the preview.
        const timeout = setTimeout(cancel, source === 'v2' ? 15000 : 5000);
        try {
            return await Promise.race([
                source === 'v2'
                    ? this._router.getQuote({ ...params, signal: controller.signal })
                    : this._getRefQuote({ ...params, signal: controller.signal }),
                aborted,
            ]);
        } finally {
            clearTimeout(timeout);
            params.signal?.removeEventListener('abort', cancel);
            controller.signal.removeEventListener('abort', onAbort);
            controller.abort();
        }
    }

    async swap({
        account,
        quote,
        tokenIn,
        tokenOut,
        amountIn,
        slippage,
        isCurrent = () => true,
    }) {
        const params = { account, tokenIn, tokenOut, amountIn, slippage };
        const context = createQuoteContext(params);
        const current = () => isCurrent() && sameQuoteContext(context, quote.context);
        if (!current()) {
            throw new Error('Swap account or input changed. Please review again.');
        }
        const fresh =
            quote.source === 'wrap'
                ? await this._getWrapQuote({ ...params, context })
                : await this._getSourceQuote(quote.source, {
                      ...params,
                      context,
                      poolsByIds: {
                          [quote.execution.poolId]: { poolId: quote.execution.poolId },
                      },
                  });
        if (!current()) {
            throw new Error('Swap account or input changed. Please review again.');
        }
        if (requiresQuoteReview(quote, fresh)) {
            return { reviewRequired: true, quote: fresh };
        }
        if (Big(fresh.priceImpactPercent).gt(6)) {
            throw new Error('Price impact is too high. Please review again.');
        }
        const result = await this._execute(
            fresh.transactions,
            account.accountId,
            current
        );
        if (result.retry) {
            return { retry: true };
        }
        return this._formatResult(result, fresh);
    }

    _formatResult(result, quote) {
        if (result.unconfirmed && Number.isInteger(result.transactionIndex)) {
            quote = {
                ...quote,
                execution: {
                    ...quote.execution,
                    pendingTransactionIndex: result.transactionIndex,
                },
            };
        }
        const outcome = result.unconfirmed
            ? { success: false, unconfirmed: true, failReason: result.failReason }
            : quote.source === 'v2'
            ? this._router.interpretResult({ result, quote })
            : {
                  success: !!result.success,
                  failReason: result.success
                      ? ''
                      : 'Swap failed. Check the transaction for details.',
              };
        return {
            ...outcome,
            quote,
            swapTxHash: result.txHash,
            routeTokenIds: quote.routeTokenIds,
            amountOut:
                outcome.amountOutRaw && Number.isInteger(quote.outputDecimals)
                    ? fromRaw(
                          outcome.amountOutRaw,
                          quote.context.tokenOutId === CONFIG.NEAR_ID
                              ? 24
                              : quote.outputDecimals
                      )
                    : undefined,
        };
    }

    async checkSwapResult({ account, quote, hash }) {
        if (!quote || account.accountId !== quote.context.accountId || !hash) {
            throw new Error('This transaction belongs to a different swap account.');
        }
        const outcome = await account.connection.provider.txStatus(
            hash,
            account.accountId
        );
        const success =
            !!outcome.status &&
            Object.prototype.hasOwnProperty.call(outcome.status, 'SuccessValue') &&
            Array.isArray(outcome.receipts_outcome) &&
            !outcome.receipts_outcome.some((receipt) => receipt.outcome.status?.Failure);
        if (
            !success &&
            !outcome.status?.Failure &&
            !outcome.receipts_outcome?.some((receipt) => receipt.outcome.status?.Failure)
        ) {
            return {
                success: false,
                unconfirmed: true,
                swapTxHash: hash,
                failReason: 'Transaction is not confirmed yet. Check its status again.',
            };
        }
        if (
            Number.isInteger(quote.execution?.pendingTransactionIndex) &&
            quote.execution.pendingTransactionIndex < quote.transactions.length - 1
        ) {
            return {
                success: false,
                unconfirmed: false,
                swapTxHash: hash,
                failReason: !success
                    ? 'A swap transaction failed. Check your activity and token balances before trying again.'
                    : quote.source === 'v2'
                    ? 'Preparation completed. The swap was not submitted. Review a new quote to continue.'
                    : 'Only part of the swap transaction plan was submitted. Check your activity and token balances before trying again.',
            };
        }
        if (
            quote.execution?.withdrawal &&
            outcome.transaction?.actions &&
            !outcome.transaction.actions.some(
                (action) => action.FunctionCall?.method_name === 'withdraw'
            )
        ) {
            return {
                success: false,
                unconfirmed: false,
                swapTxHash: hash,
                failReason:
                    'Withdrawal preparation finished. No withdrawal was submitted. Refresh the balance to continue.',
            };
        }
        return this._formatResult({ success, data: [outcome], txHash: hash }, quote);
    }

    async checkWithdrawalResult({ account, tokenId, hash }) {
        const quote = {
            source: 'v2',
            context: {
                accountId: account.accountId,
                tokenInId: tokenId,
                tokenOutId: tokenId,
            },
            routeTokenIds: [tokenId],
            minAmountOutRaw: '0',
            execution: { withdrawal: true },
        };
        return this.checkSwapResult({ account, quote, hash });
    }

    isNearTransformation({ tokenIn, tokenOut }) {
        const ids = [tokenIn.contractName, tokenOut.contractName];
        return ids.includes(CONFIG.NEAR_TOKEN_ID) && ids.includes(CONFIG.NEAR_ID);
    }

    replaceNearIdIfNecessary(id) {
        return id === CONFIG.NEAR_ID ? CONFIG.NEAR_TOKEN_ID : id;
    }

    async _getRefQuote(params) {
        const { account, tokenIn, tokenOut, context, slippage } = params;
        const tokenInId = this.replaceNearIdIfNecessary(tokenIn.contractName);
        const tokenOutId = this.replaceNearIdIfNecessary(tokenOut.contractName);
        const outputDecimals = tokenOut.onChainFTMetadata.decimals;
        const estimate = await this._exchangeContract.estimate({
            ...params,
            tokenInId,
            tokenOutId,
            tokenInDecimals: tokenIn.onChainFTMetadata.decimals,
            tokenOutDecimals: outputDecimals,
        });
        if (
            !estimate.priceImpactPercent ||
            !Number.isFinite(Number(estimate.priceImpactPercent))
        ) {
            throw new Error('Ref price impact unavailable');
        }
        const minAmountOutRaw = Big(estimate.amountOutRaw)
            .times(Big(1).minus(Big(slippage).div(100)))
            .round(0, Big.roundDown)
            .toFixed(0);
        if (!Big(minAmountOutRaw).gt(0)) {
            throw new Error('Swap amount is too small');
        }
        const registration = await this._getRegistrationTransactions(account, [
            tokenInId,
            tokenOutId,
        ]);
        const txs = [...registration.transactions];
        if (tokenIn.contractName === CONFIG.NEAR_ID) {
            txs.push(this._wrapTransaction(context.amountIn));
        }
        txs.push({
            receiverId: tokenInId,
            actions: await this._exchangeContract.getSwapActions({
                poolId: estimate.poolId,
                tokenInId,
                tokenOutId,
                amountInRaw: context.amountIn,
                minAmountOutRaw,
            }),
        });
        if (tokenOut.contractName === CONFIG.NEAR_ID) {
            txs.push(this._unwrapTransaction(minAmountOutRaw));
        }
        return {
            source: 'ref',
            context,
            ...estimate,
            minAmountOutRaw,
            minAmountOut: fromRaw(minAmountOutRaw, outputDecimals),
            outputDecimals,
            estimatedFee: await this._estimateFee(account, txs, {
                nativePrincipalRaw:
                    tokenIn.contractName === CONFIG.NEAR_ID ? context.amountIn : '0',
            }),
            transactions: txs,
            registrationKey: registration.key,
            routeTokenIds: [tokenInId, tokenOutId],
            execution: { poolId: estimate.poolId },
        };
    }

    async _getWrapQuote({ account, tokenIn, tokenOut, amountIn, context }) {
        const registration = await this._getRegistrationTransactions(account, [
            CONFIG.NEAR_TOKEN_ID,
        ]);
        const wrap = tokenIn.contractName === CONFIG.NEAR_ID;
        const txs = [
            ...registration.transactions,
            wrap
                ? this._wrapTransaction(context.amountIn)
                : this._unwrapTransaction(context.amountIn),
        ];
        return {
            source: 'wrap',
            context,
            amountOutRaw: context.amountIn,
            minAmountOutRaw: context.amountIn,
            amountOut: amountIn,
            minAmountOut: amountIn,
            outputDecimals: tokenOut.onChainFTMetadata.decimals,
            priceImpactPercent: '0',
            swapFee: null,
            estimatedFee: await this._estimateFee(account, txs, {
                nativePrincipalRaw: wrap ? context.amountIn : '0',
            }),
            transactions: txs,
            registrationKey: registration.key,
            routeTokenIds: [CONFIG.NEAR_TOKEN_ID],
            execution: {},
        };
    }

    _wrapTransaction(amount) {
        return {
            receiverId: CONFIG.NEAR_TOKEN_ID,
            actions: [
                transactions.functionCall(
                    'near_deposit',
                    {},
                    CONFIG.FT_STORAGE_DEPOSIT_GAS,
                    amount
                ),
            ],
        };
    }

    _unwrapTransaction(amount) {
        return {
            receiverId: CONFIG.NEAR_TOKEN_ID,
            actions: [
                transactions.functionCall(
                    'near_withdraw',
                    { amount },
                    CONFIG.FT_STORAGE_DEPOSIT_GAS,
                    '1'
                ),
            ],
        };
    }

    async _getRegistrationTransactions(account, tokenIds) {
        const txs = [];
        const missing = [];
        for (const tokenId of new Set(tokenIds)) {
            const storage = await account.viewFunction(tokenId, 'storage_balance_of', {
                account_id: account.accountId,
            });
            if (!storage) {
                const bounds = await account.viewFunction(
                    tokenId,
                    'storage_balance_bounds',
                    {}
                );
                if (!/^\d+$/.test(bounds?.min) || !Big(bounds.min).gt(0)) {
                    throw new Error('Token storage cost unavailable');
                }
                missing.push(tokenId);
                txs.push({
                    receiverId: tokenId,
                    actions: [
                        transactions.functionCall(
                            'storage_deposit',
                            {
                                account_id: account.accountId,
                                registration_only: true,
                            },
                            CONFIG.FT_STORAGE_DEPOSIT_GAS,
                            bounds.min
                        ),
                    ],
                });
            }
        }
        return { transactions: txs, key: missing.sort().join(',') };
    }

    async getRecoverableBalances(account) {
        return CONFIG.CURRENT_NEAR_NETWORK === 'mainnet'
            ? this._router.getBalances(account)
            : [];
    }

    async withdraw({ account, tokenId, isCurrent = () => true }) {
        if (CONFIG.CURRENT_NEAR_NETWORK !== 'mainnet' || !isCurrent()) {
            throw new Error('Withdrawal account changed. Please try again.');
        }
        const balances = await this._router.getBalances(account);
        const balance = balances.find((item) => item.tokenId === tokenId);
        if (!balance) {
            throw new Error('No balance available to withdraw');
        }
        const txs = await this._router.getWithdrawalTransactions({ account, tokenId });
        if (!isCurrent()) {
            throw new Error('Withdrawal account changed. Please try again.');
        }
        const result = await this._execute(txs, account.accountId, isCurrent);
        if (result.retry) {
            return { retry: true };
        }
        return {
            ...(result.unconfirmed
                ? { success: false, unconfirmed: true, failReason: result.failReason }
                : this._router.interpretResult({
                      result,
                      quote: {
                          context: {
                              accountId: account.accountId,
                              tokenInId: tokenId,
                              tokenOutId: tokenId,
                          },
                          routeTokenIds: [tokenId],
                          minAmountOutRaw: '0',
                      },
                  })),
            swapTxHash: result.txHash,
        };
    }
}

export default new FungibleTokenExchange();
