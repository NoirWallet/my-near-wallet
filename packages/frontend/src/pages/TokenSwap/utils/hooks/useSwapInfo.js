import { useEffect, useState } from 'react';

import usePools from './usePools';
import useDebouncedValue from '../../../../hooks/useDebouncedValue';
import fungibleTokenExchange from '../../../../services/tokenExchange';
import { useSwapData } from '../../model/Swap';
import { SWAP_INFO_DELAY, NOTIFICATION_TYPE } from '../constants';

export default function useSwapInfo({
    account,
    tokenIn,
    amountIn = '',
    tokenOut,
    slippage,
    delay = SWAP_INFO_DELAY,
}) {
    const {
        events: { setSelectedQuote },
    } = useSwapData();
    const { pools } = usePools({ tokenIn, tokenOut });
    const debouncedAmountIn = useDebouncedValue(amountIn, delay);
    const [loading, setLoading] = useState(false);
    const [swapNotification, setSwapNotification] = useState(null);

    useEffect(() => {
        const controller = new AbortController();
        let cancelled = false;

        if (
            !account ||
            !tokenIn ||
            !tokenOut ||
            amountIn !== debouncedAmountIn ||
            !Number(debouncedAmountIn)
        ) {
            setLoading(false);
            setSwapNotification(null);
            return () => controller.abort();
        }

        setLoading(true);
        setSwapNotification(null);
        fungibleTokenExchange
            .estimate({
                account,
                tokenIn,
                tokenOut,
                amountIn: debouncedAmountIn,
                slippage,
                poolsByIds: pools,
                signal: controller.signal,
            })
            .then((quote) => {
                if (!cancelled) {
                    setSelectedQuote(quote);
                }
            })
            .catch((error) => {
                if (cancelled) {
                    return;
                }
                setSelectedQuote(null);
                setSwapNotification({
                    id:
                        error?.code === 'NO_ROUTE'
                            ? 'swap.noPoolAvailable'
                            : 'swap.poolsError',
                    type:
                        error?.code === 'NO_ROUTE'
                            ? NOTIFICATION_TYPE.warning
                            : NOTIFICATION_TYPE.error,
                    data: {
                        tokenIn: tokenIn.onChainFTMetadata.symbol,
                        tokenOut: tokenOut.onChainFTMetadata.symbol,
                    },
                });
            })
            .finally(() => {
                if (!cancelled) {
                    setLoading(false);
                }
            });

        return () => {
            cancelled = true;
            controller.abort();
        };
    }, [account, tokenIn, tokenOut, amountIn, debouncedAmountIn, slippage, pools]);

    return {
        swapNotification,
        loading: loading || amountIn !== debouncedAmountIn,
    };
}
