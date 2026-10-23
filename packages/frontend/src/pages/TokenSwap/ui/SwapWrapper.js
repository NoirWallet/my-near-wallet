import React, { memo } from 'react';

import Preview from './Preview';
import Success from './Success';
import SwapForm from './SwapForm';
import { Mixpanel } from '../../../mixpanel';
import { toSignificantDecimals } from '../../../utils/amounts';
import { openTransactionInExplorer } from '../../../utils/window';
import { useSwapData, VIEW_STATE } from '../model/Swap';
import { DECIMALS_TO_SAFE } from '../utils/constants';
import useSwap from '../utils/hooks/useSwap';

export default memo(function SwapWrapper({ history, account, tokensConfig }) {
    const {
        swapState: {
            viewState,
            tokenIn,
            amountIn,
            tokenOut,
            selectedQuote,
            slippage,
            lastSwapState,
            swapPending,
        },
        events: { setViewState, setAmountIn },
    } = useSwapData();
    const amountOut = selectedQuote?.amountOut || '';

    const goHome = () => {
        if (!swapPending) {
            history.push('/');
        }
    };
    const showForm = () => {
        if (!swapPending) {
            setViewState(VIEW_STATE.inputForm);
        }
    };
    const updateForm = () => {
        setAmountIn('');
        setViewState(VIEW_STATE.inputForm);
    };

    const swap = useSwap({
        account,
        amountIn,
        quote: selectedQuote,
        tokenIn,
        tokenOut,
        slippage,
    });

    const handleSwap = () => {
        if (swap && !swapPending) {
            Mixpanel.track('Click Confirm & Swap on Swap page');
            swap();
        }
    };

    const openTransaction = () => {
        if (lastSwapState?.hash) {
            openTransactionInExplorer(lastSwapState.hash);
        }
    };

    const amountInToShow = toSignificantDecimals(amountIn, DECIMALS_TO_SAFE);
    const amountOutToShow = toSignificantDecimals(amountOut, DECIMALS_TO_SAFE);

    return viewState === VIEW_STATE.inputForm ? (
        <SwapForm onGoBack={goHome} account={account} tokensConfig={tokensConfig} />
    ) : viewState === VIEW_STATE.preview ? (
        <Preview
            onClickGoBack={showForm}
            activeTokenFrom={tokenIn}
            amountTokenFrom={amountInToShow}
            activeTokenTo={tokenOut}
            amountTokenTo={amountOutToShow}
            startSwap={handleSwap}
            swappingToken={swapPending}
        />
    ) : viewState === VIEW_STATE.result ? (
        <Success
            onClickContinue={updateForm}
            onClickGoToExplorer={openTransaction}
            account={account}
        />
    ) : null;
});
