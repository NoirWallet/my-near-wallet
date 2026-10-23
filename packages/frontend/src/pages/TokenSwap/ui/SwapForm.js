import Big from 'big.js';
import React, { useState, memo, useMemo, useEffect } from 'react';
import { Translate } from 'react-localize-redux';
import { useSelector } from 'react-redux';
import styled from 'styled-components';

import Input from './Input';
import SwapDetails from './SwapDetails/SwapDetails';
import BackArrowButton from '../../../components/common/BackArrowButton';
import FlipButton from '../../../components/common/FlipButton';
import FormButton from '../../../components/common/FormButton';
import Notification from '../../../components/common/Notification';
import SelectToken from '../../../components/send/components/views/SelectToken';
import CONFIG from '../../../config';
import { selectAvailableBalance } from '../../../redux/slices/account';
import { formatTokenAmount } from '../../../utils/amounts';
import { NEAR_DECIMALS } from '../../../utils/constants';
import isMobile from '../../../utils/isMobile';
import { useSwapData, VIEW_STATE } from '../model/Swap';
import {
    PRICE_IMPACT_THRESHOLD,
    NOTIFICATION_TYPE,
} from '../utils/constants';
import useSwapInfo from '../utils/hooks/useSwapInfo';
import useTokenPair from '../utils/hooks/useTokenPair';
import { formatPriceImpact } from '../utils/formatPriceImpact';
import LoadingDots from '../../../components/common/loader/LoadingDots';
import RecoverableBalances from './RecoverableBalances';

const mobile = isMobile();

const SwapFormWrapper = styled.div`
    // Styles for the <SelectToken /> component.
    // We use the same styles in the old swap components.
    // @todo find a way to use it in one place.
    // Can we put it in <SelectToken /> ?
    div.header {
        position: relative;
        display: flex;
        align-items: center;
        justify-content: center;
        color: #272729;
        font-weight: 600;
        font-size: 20px;
        word-break: break-all;

        .back-arrow-button {
            position: absolute;
            left: 0;
        }
    }
`;

const Header = styled.div`
    margin-bottom: 2.125rem;
    display: grid;
    grid-template-columns: repeat(3, 1fr);

    .title {
        font-family: 'Inter';
        font-style: normal;
        font-size: 1.25rem;
        line-height: 1.5rem;
        text-align: center;
        font-weight: 700;
        margin: auto;
    }

    &[aria-disabled='true'] .back-arrow-button {
        opacity: 0.5;
        pointer-events: none;
    }
`;

const SwapButtonWrapper = styled.div`
    margin: 0.8rem 0;
    display: flex;
    justify-content: center;

    &[aria-disabled='true'] button {
        opacity: 0.5;
        pointer-events: none;
    }
`;

const Footer = styled.div`
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    margin-top: 0.8rem;

    button {
        width: 100%;
    }

    .cancel-button-wrapper {
        margin-top: 1rem;
    }
`;

const tokenSelectState = {
    noSelect: 0,
    selectIn: 1,
    selectOut: 2,
};

const SwapForm = memo(({ onGoBack, account, tokensConfig }) => {
    const availableBalance = useSelector(selectAvailableBalance);
    const { listOfTokensIn, listOfTokensOut } = tokensConfig;
    const [zeroAmountOut, setZeroAmountOut] = useState(false);
    const {
        swapState: { tokenIn, tokenOut, amountIn, selectedQuote, slippage, swapPending },
        events: { setViewState, setTokenIn, setTokenOut, setAmountIn },
    } = useSwapData();
    const amountOut = selectedQuote?.amountOut || '';
    const estimatedFee = selectedQuote?.estimatedFee || 0;
    const priceImpactPercent = selectedQuote?.priceImpactPercent || '';
    const displayedPriceImpact =
        priceImpactPercent > PRICE_IMPACT_THRESHOLD.warning
            ? formatPriceImpact(priceImpactPercent)
            : '';

    useTokenPair(tokensConfig);

    const onClickReview = () => {
        if (!swapPending) {
            setViewState(VIEW_STATE.preview);
        }
    };

    const [displayTokenSelect, setDisplayTokenSelect] = useState(
        tokenSelectState.noSelect
    );
    const tokensToSelect = useMemo(() => {
        if (!displayTokenSelect) {
            return [];
        }

        return displayTokenSelect === tokenSelectState.selectIn
            ? listOfTokensIn
            : listOfTokensOut;
    }, [displayTokenSelect, listOfTokensIn, listOfTokensOut]);

    const selectTokenIn = () => {
        if (!swapPending) {
            setDisplayTokenSelect(tokenSelectState.selectIn);
        }
    };
    const selectTokenOut = () => {
        if (!swapPending) {
            setDisplayTokenSelect(tokenSelectState.selectOut);
        }
    };
    const hideTokenSelection = () => {
        if (!swapPending) {
            setDisplayTokenSelect(tokenSelectState.noSelect);
        }
    };

    const handleTokenSelect = (token) => {
        if (swapPending) {
            return;
        }
        switch (displayTokenSelect) {
            case tokenSelectState.selectIn:
                if (token.contractName === tokenOut.contractName) {
                    setTokenOut(tokenIn);
                }
                setTokenIn(token);
                break;
            case tokenSelectState.selectOut:
                if (token.contractName === tokenIn.contractName) {
                    setTokenIn(tokenOut);
                }
                setTokenOut(token);
                break;
        }

        setDisplayTokenSelect(tokenSelectState.noSelect);
    };

    const handleInputAmountChange = (value) => {
        if (!swapPending) {
            setAmountIn(value);
        }
    };

    const { swapNotification, loading } = useSwapInfo({
        account,
        tokenIn,
        amountIn,
        tokenOut,
        slippage,
    });

    const [notification, setNotification] = useState(null);

    useEffect(() => {
        if (notification) {
            setNotification(null);
        }

        if (swapNotification) {
            setNotification(swapNotification);
        } else if (estimatedFee && availableBalance) {
            const formattedBalance = formatTokenAmount(
                availableBalance,
                NEAR_DECIMALS,
                NEAR_DECIMALS
            );

            // If we have NEAR in the input field check is available balance >= amount + swap fee
            if (
                tokenIn?.contractName === CONFIG.NEAR_ID &&
                amountIn &&
                Big(estimatedFee).plus(amountIn).gt(formattedBalance)
            ) {
                setNotification({
                    id: 'swap.insufficientBalanceForAmountAndFee',
                    type: NOTIFICATION_TYPE.warning,
                });
            } else if (Big(estimatedFee).gt(formattedBalance)) {
                setNotification({
                    id: 'swap.insufficientBalanceForFee',
                    type: NOTIFICATION_TYPE.warning,
                });
            }
        }
    }, [tokenIn, amountIn, availableBalance, estimatedFee, swapNotification]);

    const flipInputsData = () => {
        if (swapPending) {
            return;
        }
        setTokenIn(tokenOut);
        setTokenOut(tokenIn);

        if (amountOut) {
            setAmountIn(amountOut);
        }
    };

    const [isValidInput, setIsValidInput] = useState(false);

    const canSwap = useMemo(() => {
        const formIsFilled = Boolean(
            tokenIn && tokenOut && selectedQuote && amountIn && amountOut
        );

        let isZeroOutput = false;

        if (formIsFilled && availableBalance) {
            const formattedBalance = formatTokenAmount(
                availableBalance,
                NEAR_DECIMALS,
                NEAR_DECIMALS
            );
            const isInsufficientBalance = Big(estimatedFee)
                .plus(tokenIn?.contractName === CONFIG.NEAR_ID ? amountIn : 0)
                .gt(formattedBalance);

            if (isValidInput && !isInsufficientBalance) {
                if (Number(amountOut) > 0) {
                    return true;
                } else {
                    isZeroOutput = true;
                }
            }
        }
        setZeroAmountOut(isZeroOutput);
        return false;
    }, [
        tokenIn,
        tokenOut,
        selectedQuote,
        amountIn,
        amountOut,
        isValidInput,
        estimatedFee,
        availableBalance,
    ]);

    return (
        <SwapFormWrapper>
            {displayTokenSelect ? (
                <SelectToken
                    isMobile={mobile}
                    onClickGoBack={hideTokenSelection}
                    fungibleTokens={tokensToSelect}
                    onSelectToken={handleTokenSelect}
                    balanceLabelId='available'
                />
            ) : (
                <>
                    <Header aria-disabled={swapPending}>
                        <BackArrowButton onClick={swapPending ? undefined : onGoBack} />
                        <h4 className='title'>
                            <Translate id='swap.title' />
                        </h4>
                    </Header>
                    <Input
                        value={amountIn}
                        onChange={handleInputAmountChange}
                        onSelectToken={selectTokenIn}
                        labelId='swap.from'
                        tokenSymbol={tokenIn?.onChainFTMetadata?.symbol}
                        tokenIcon={tokenIn?.onChainFTMetadata?.icon}
                        tokenDecimals={tokenIn?.onChainFTMetadata?.decimals}
                        maxBalance={tokenIn?.balance}
                        setIsValidInput={setIsValidInput}
                        inputTestId='swapPageInputAmountField'
                        tokenSelectTestId='swapPageInputTokenSelector'
                        autoFocus
                        disabled={swapPending}
                        disableTokenSelect={swapPending}
                    />
                    <SwapButtonWrapper aria-disabled={swapPending}>
                        <FlipButton onClick={swapPending ? undefined : flipInputsData} />
                    </SwapButtonWrapper>
                    {tokensConfig.isLoadingAllTokens ? (
                        <LoadingDots />
                    ) : (
                        <Input
                            value={amountOut}
                            onSelectToken={swapPending ? undefined : selectTokenOut}
                            labelId='swap.to'
                            tokenSymbol={tokenOut?.onChainFTMetadata?.symbol}
                            tokenIcon={tokenOut?.onChainFTMetadata?.icon}
                            tokenDecimals={tokenOut?.onChainFTMetadata?.decimals}
                            maxBalance={tokenOut?.balance}
                            loading={loading}
                            inputTestId='swapPageOutputAmountField'
                            tokenSelectTestId='swapPageOutputTokenSelector'
                            disabled
                            disableTokenSelect={swapPending}
                        />
                    )}
                    <Footer>
                        <SwapDetails />

                        {notification && (
                            <Notification type={notification.type}>
                                <Translate
                                    id={notification.id}
                                    data={notification.data}
                                />
                            </Notification>
                        )}

                        {zeroAmountOut && (
                            <Notification type='error'>
                                <Translate id='swap.inputTooLow' />
                            </Notification>
                        )}

                        {priceImpactPercent > PRICE_IMPACT_THRESHOLD.error ? (
                            <div className='p-3 mt-2 border-red-600 text-red-600 text-md bg-red-100 rounded-lg border-solid border-1'>
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
                            disabled={
                                !canSwap ||
                                swapPending ||
                                priceImpactPercent > PRICE_IMPACT_THRESHOLD.error
                            }
                            onClick={onClickReview}
                            trackingId='Click Preview swap on Swap page'
                            data-test-id='swapPageSwapPreviewStateButton'
                        >
                            <Translate id='swap.review' />
                        </FormButton>
                        <div className='cancel-button-wrapper'>
                            <FormButton
                                color='link gray'
                                onClick={onGoBack}
                                disabled={swapPending}
                            >
                                <Translate id='button.cancel' />
                            </FormButton>
                        </div>
                    </Footer>
                    <RecoverableBalances account={account} />
                </>
            )}
        </SwapFormWrapper>
    );
});

export default SwapForm;
