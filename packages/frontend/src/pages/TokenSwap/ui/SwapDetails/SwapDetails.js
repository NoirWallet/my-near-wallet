import Big from 'big.js';
import React, { useState } from 'react';

import FtSwapDetails from './FtSwapDetails';
import NearTransformationDetails from './NearTransformationDetails';
import { SwapDetailsWrapper, AccordionTitle } from './ui';
import Accordion from '../../../../components/common/Accordion';
import ChevronIcon from '../../../../components/svg/ChevronIcon';
import { toSignificantDecimals } from '../../../../utils/amounts';
import { useSwapData } from '../../model/Swap';
import { getSwapFeeAmount } from '../../utils/calculations';
import { DECIMALS_TO_SAFE } from '../../utils/constants';

export default function SwapDetails() {
    const {
        swapState: { tokenIn, amountIn, tokenOut, selectedQuote },
    } = useSwapData();
    const amountOut = selectedQuote?.amountOut || '';
    const swapFee = selectedQuote?.swapFee;
    const estimatedFee = selectedQuote?.estimatedFee;
    const isNearTransformation = selectedQuote?.source === 'wrap';

    const [isActive, setIsActive] = useState(false);

    const toggleDetailsView = () => setIsActive((view) => !view);

    const swapFeeAmount = getSwapFeeAmount({
        amountIn,
        swapFee,
    });
    const minAmountOut = selectedQuote?.minAmountOut || '';
    const minAmountOutToShow = toSignificantDecimals(minAmountOut, DECIMALS_TO_SAFE);

    const isVisible = tokenIn && tokenOut && Number(amountIn);
    let price = '-';

    if (isVisible && amountOut) {
        if (Number(amountOut) !== 0) {
            price = toSignificantDecimals(
                Big(amountIn).div(amountOut).toFixed(),
                DECIMALS_TO_SAFE
            );
        }
    }

    return (
        <SwapDetailsWrapper className={`${isVisible ? 'visible' : ''}`}>
            <AccordionTitle
                id='swapDetailsTitle'
                className={`${isActive ? 'active' : ''}`}
                onClick={toggleDetailsView}
            >
                1 {tokenOut?.onChainFTMetadata?.symbol}
                {' = '}
                {price} {tokenIn?.onChainFTMetadata?.symbol}
                <ChevronIcon color='var(--mnw-color-1)' />
            </AccordionTitle>
            <Accordion trigger='swapDetailsTitle' className='breakdown'>
                {isNearTransformation ? (
                    <NearTransformationDetails
                        minAmountOut={minAmountOutToShow}
                        estimatedFee={estimatedFee}
                    />
                ) : (
                    <FtSwapDetails
                        minAmountOut={minAmountOutToShow}
                        swapFeeAmount={swapFeeAmount}
                        estimatedFee={estimatedFee}
                    />
                )}
            </Accordion>
        </SwapDetailsWrapper>
    );
}
