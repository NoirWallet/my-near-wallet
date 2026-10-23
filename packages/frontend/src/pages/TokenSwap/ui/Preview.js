import React from 'react';
import { Translate } from 'react-localize-redux';
import styled from 'styled-components';

import PreviewInfo from './PreviewInfo';
import BackArrowButton from '../../../components/common/BackArrowButton';
import FormButton from '../../../components/common/FormButton';
import { removeTrailingZeros } from '../../../utils/amounts';
import { useSwapData } from '../model/Swap';
import { PRICE_IMPACT_THRESHOLD } from '../utils/constants';
import { formatPriceImpact } from '../utils/formatPriceImpact';

const StyledContainer = styled.div`
    &[aria-busy='true'] .back-arrow-button {
        opacity: 0.5;
        pointer-events: none;
    }

    h4 {
        font-family: 'Inter';
        font-style: normal;
        font-weight: 700;
        font-size: 20px;
        line-height: 24px;
        text-align: center;
        font-weight: 700;
        margin: auto;
        white-space: nowrap;
    }

    div.header {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
    }

    div.flexCenter {
        display: flex;
        justify-content: center;
    }

    div.flexCenterColumn {
        display: flex;
        flex-direction: column;
        justify-content: center;
        align-items: center;
    }

    div.flexCenterButton {
        display: flex;
        justify-content: center;
        margin-top: 28px;
    }

    .width100 {
        width: 100%;
    }
`;

const getFontSize = (charLength) => {
    let baseSize = 24;

    if (charLength > 10) {
        baseSize = 20;
    }

    if (charLength >= baseSize) {
        baseSize = 16;
    }

    return baseSize;
};

export default function Preview({
    onClickGoBack,
    amountTokenFrom,
    amountTokenTo,
    activeTokenFrom,
    activeTokenTo,
    startSwap,
    swappingToken,
}) {
    const tokenFromFiatPrice = activeTokenFrom?.fiatValueMetadata?.usd;
    const tokenFromFiatAmount = tokenFromFiatPrice
        ? amountTokenFrom * tokenFromFiatPrice
        : null;

    const handleSwap = () => {
        if (!swappingToken && typeof startSwap === 'function') {
            startSwap();
        }
    };

    const {
        swapState: { selectedQuote },
    } = useSwapData();
    const priceImpactPercent = selectedQuote?.priceImpactPercent || '';
    const displayedPriceImpact =
        priceImpactPercent > PRICE_IMPACT_THRESHOLD.warning
            ? formatPriceImpact(priceImpactPercent)
            : '';

    return (
        <StyledContainer aria-busy={swappingToken}>
            <div className='header'>
                <BackArrowButton onClick={swappingToken ? undefined : onClickGoBack} />
                <h4>
                    <Translate id='swap.reviewInfo' />
                </h4>
            </div>
            <div className='flexCenterColumn'>
                <h1
                    style={{
                        fontSize: `${
                            amountTokenFrom.length
                                ? getFontSize(amountTokenFrom.length)
                                : 24
                        }px`,
                    }}
                >{`${
                    !!(amountTokenFrom % 1)
                        ? removeTrailingZeros(amountTokenFrom)
                        : amountTokenFrom
                } ${activeTokenFrom.onChainFTMetadata?.symbol}`}</h1>
                {tokenFromFiatAmount && (
                    <div>{`≈ ${(
                        amountTokenFrom * activeTokenFrom.fiatValueMetadata.usd
                    ).toFixed(2)} USD`}</div>
                )}
            </div>
            <PreviewInfo
                amountTokenFrom={amountTokenFrom}
                tokenFrom={activeTokenFrom}
                tokenTo={activeTokenTo}
                amountTokenTo={amountTokenTo}
            />

            {}

            {priceImpactPercent > PRICE_IMPACT_THRESHOLD.error ? (
                <div
                    className='p-3 mt-2 border-red-600 text-red-600 text-md bg-red-100 rounded-lg border-solid border-1'
                    data-test-id='swapPriceDisabledWarning'
                >
                    Price impact is {displayedPriceImpact}%. Swap unavailable.
                </div>
            ) : priceImpactPercent > PRICE_IMPACT_THRESHOLD.warning ? (
                <div className='p-3 mt-2 border-yellow-800 text-yellow-800 text-md bg-yellow-100 rounded-lg border-solid border-1'>
                    Price impact is {displayedPriceImpact}%.
                </div>
            ) : (
                <></>
            )}

            <FormButton
                color='blue width100'
                disabled={
                    swappingToken === true ||
                    priceImpactPercent > PRICE_IMPACT_THRESHOLD.error
                }
                sending={swappingToken === true}
                sendingString='swapping'
                data-test-id='swapPageStartSwapButton'
                onClick={handleSwap}
            >
                <Translate id='swap.confirm' />
            </FormButton>

            <div className='flexCenterButton'>
                <FormButton
                    color='gray link'
                    onClick={onClickGoBack}
                    disabled={swappingToken}
                >
                    <Translate id='button.cancel' />
                </FormButton>
            </div>
        </StyledContainer>
    );
}
