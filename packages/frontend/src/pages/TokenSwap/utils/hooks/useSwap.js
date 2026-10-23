import Big from 'big.js';
import { useEffect, useMemo, useRef } from 'react';
import { useDispatch, useSelector } from 'react-redux';

import CONFIG from '../../../../config';
import { Mixpanel } from '../../../../mixpanel';
import { showCustomAlert } from '../../../../redux/actions/status';
import selectNEARAsTokenWithMetadata from '../../../../redux/selectors/crossStateSelectors/selectNEARAsTokenWithMetadata';
import { actions } from '../../../../redux/slices/swap';
import fungibleTokenExchange from '../../../../services/tokenExchange';
import { useSwapData, VIEW_STATE } from '../../model/Swap';
import { quoteMatchesState } from '../quote';

const { updateTokensBalance } = actions;

const getUsdVolume = (amount, usdPrice) => {
    return !amount || typeof usdPrice !== 'number'
        ? 'Unavailable'
        : Big(amount).times(usdPrice).toFixed();
};

const getAmountStats = ({ tokenIn, amountIn, tokenOut, amountOut, nearUsdPrice }) => {
    const tokenInId = fungibleTokenExchange.replaceNearIdIfNecessary(
        tokenIn.contractName
    );
    const tokenOutId = fungibleTokenExchange.replaceNearIdIfNecessary(
        tokenOut.contractName
    );

    if (tokenInId === CONFIG.NEAR_TOKEN_ID) {
        return {
            volumeNear: amountIn,
            volumeUSD: getUsdVolume(amountIn, nearUsdPrice),
        };
    }
    if (tokenOutId === CONFIG.NEAR_TOKEN_ID) {
        return {
            volumeNear: amountOut,
            volumeUSD: getUsdVolume(amountOut, nearUsdPrice),
        };
    }
    return {
        inputAmountUSD: getUsdVolume(amountIn, tokenIn.fiatValueMetadata.usd),
    };
};

export default function useSwap({
    account,
    amountIn,
    quote,
    tokenIn,
    tokenOut,
    slippage,
}) {
    const nearConfig = useSelector((state) =>
        selectNEARAsTokenWithMetadata(state, { includeNearContractName: true })
    );
    const dispatch = useDispatch();
    const {
        swapState,
        events: { setSelectedQuote, setSwapPending, setCompletedSwapState, setViewState },
    } = useSwapData();
    const current = useRef({ account, swapState });
    const mounted = useRef(true);
    const inFlight = useRef(false);
    current.current = { account, swapState };

    useEffect(
        () => () => {
            mounted.current = false;
        },
        []
    );

    return useMemo(() => {
        if (
            !account ||
            !quote ||
            !tokenIn ||
            !tokenOut ||
            !amountIn ||
            !quoteMatchesState(quote, swapState)
        ) {
            return null;
        }

        const isCurrent = () =>
            mounted.current &&
            current.current.account?.accountId === account.accountId &&
            current.current.swapState.selectedQuote === quote &&
            quoteMatchesState(quote, current.current.swapState);

        return async () => {
            if (inFlight.current || !isCurrent()) {
                return;
            }
            inFlight.current = true;
            setSwapPending(true);
            const statisticalParameters = {
                tokenFrom: tokenIn.onChainFTMetadata.symbol,
                tokenFromAddress: tokenIn.contractName,
                tokenTo: tokenOut.onChainFTMetadata.symbol,
                tokenToAddress: tokenOut.contractName,
                ...getAmountStats({
                    tokenIn,
                    amountIn,
                    tokenOut,
                    amountOut: quote.minAmountOut,
                    nearUsdPrice: nearConfig?.fiatValueMetadata?.usd,
                }),
            };

            try {
                const result = await fungibleTokenExchange.swap({
                    account,
                    quote,
                    tokenIn,
                    tokenOut,
                    amountIn,
                    slippage,
                    isCurrent,
                });
                if (result.reviewRequired) {
                    if (!isCurrent()) {
                        return;
                    }
                    if (result.quote) {
                        setSelectedQuote(result.quote);
                    }
                    dispatch(
                        showCustomAlert({
                            success: false,
                            messageCodeHeader: 'swap.review',
                            errorMessage:
                                'Price changed. Review the updated quote before confirming.',
                        })
                    );
                    return;
                }
                if (result.retry) {
                    return;
                }

                if (!result.unconfirmed) {
                    Mixpanel.track(`Swap:${result.success ? 'done' : 'failed'}`, {
                        failReason: result.failReason,
                        ...statisticalParameters,
                    });
                }

                const tokenIds = [
                    tokenIn.contractName,
                    tokenOut.contractName,
                    ...(result.routeTokenIds || quote.routeTokenIds || []),
                ].map((id) => fungibleTokenExchange.replaceNearIdIfNecessary(id));
                dispatch(
                    updateTokensBalance({
                        accountId: account.accountId,
                        tokenIds: [...new Set(tokenIds)],
                    })
                );
                setCompletedSwapState({
                    accountId: account.accountId,
                    success: result.success,
                    unconfirmed: result.unconfirmed,
                    hash: result.swapTxHash,
                    failReason: result.failReason,
                    amountOut: result.amountOut,
                    quote: result.quote || quote,
                    tokenIn: tokenIn.onChainFTMetadata.symbol,
                    tokenOut: tokenOut.onChainFTMetadata.symbol,
                });
                if (
                    mounted.current &&
                    current.current.account?.accountId === account.accountId
                ) {
                    setViewState(VIEW_STATE.result);
                }
            } catch (error) {
                if (!isCurrent()) {
                    return;
                }
                Mixpanel.track('Swap:failed', {
                    failReason: error.message,
                    ...statisticalParameters,
                });
                dispatch(
                    showCustomAlert({
                        success: false,
                        messageCodeHeader: 'swap.error',
                        errorMessage: error.message,
                    })
                );
            } finally {
                inFlight.current = false;
                if (mounted.current) {
                    setSwapPending(false);
                }
            }
        };
    }, [
        dispatch,
        account,
        amountIn,
        quote,
        tokenIn,
        tokenOut,
        slippage,
        swapState,
        nearConfig,
    ]);
}
