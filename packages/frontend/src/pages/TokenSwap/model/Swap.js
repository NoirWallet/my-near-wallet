import React, {
    createContext,
    useReducer,
    useMemo,
    useContext,
    useCallback,
} from 'react';
import { useDispatch } from 'react-redux';

import useIsMounted from '../../../hooks/useIsMounted';
import { showCustomAlert } from '../../../redux/actions/status';
import { DEFAULT_SLIPPAGE_PERCENT } from '../utils/constants';
import { quoteMatchesState } from '../utils/quote';

export const VIEW_STATE = {
    inputForm: 'inputForm',
    preview: 'preview',
    result: 'result',
};

const initialState = {
    accountId: '',
    viewState: VIEW_STATE.inputForm,
    tokenIn: null,
    amountIn: '',
    tokenOut: null,
    selectedQuote: null,
    slippage: DEFAULT_SLIPPAGE_PERCENT,
    lastSwapState: null,
    swapPending: false,
};

export const ACTION = {
    SET_VIEW_STATE: 'setViewState',
    SET_TOKEN_IN: 'setTokenIn',
    SET_TOKEN_OUT: 'setTokenOut',
    SET_AMOUNT_IN: 'setAmountIn',
    SET_SELECTED_QUOTE: 'setSelectedQuote',
    SET_SLIPPAGE: 'setSlippage',
    SET_SWAP_PENDING: 'setSwapPending',
    SET_COMPLETED_SWAP_STATE: 'setCompletedSwapState',
};

export function swapReducer(state, action) {
    const payload = action.payload;

    switch (action.type) {
        case ACTION.SET_VIEW_STATE:
            return { ...state, viewState: payload };
        case ACTION.SET_TOKEN_IN:
            if (state.tokenIn === payload) {
                return state;
            }
            return { ...state, tokenIn: payload, selectedQuote: null };
        case ACTION.SET_TOKEN_OUT:
            if (state.tokenOut === payload) {
                return state;
            }
            return { ...state, tokenOut: payload, selectedQuote: null };
        case ACTION.SET_AMOUNT_IN:
            return { ...state, amountIn: payload, selectedQuote: null };
        case ACTION.SET_SELECTED_QUOTE:
            return {
                ...state,
                selectedQuote: quoteMatchesState(payload, state) ? payload : null,
            };
        case ACTION.SET_SLIPPAGE:
            return { ...state, slippage: payload, selectedQuote: null };
        case ACTION.SET_SWAP_PENDING:
            return { ...state, swapPending: payload };
        case ACTION.SET_COMPLETED_SWAP_STATE:
            return { ...state, lastSwapState: payload };
        default:
            return state;
    }
}

const SwapContext = createContext(null);

export const useSwapData = () => {
    const context = useContext(SwapContext);

    if (context === undefined) {
        throw new Error('useSwapData must be used within a Provider');
    }

    return context;
};

export function SwapProvider({ children, accountId }) {
    const dispatch = useDispatch();
    const isMounted = useIsMounted();
    const [swapState, dispatchSwapAction] = useReducer(swapReducer, {
        ...initialState,
        accountId,
    });

    const dispatchIfMounted = useCallback(
        (type, payload) => {
            if (isMounted()) {
                dispatchSwapAction({ type, payload });
            } else if (type === ACTION.SET_COMPLETED_SWAP_STATE) {
                const {
                    accountId: completedAccountId,
                    success,
                    unconfirmed,
                    hash,
                    tokenIn,
                    tokenOut,
                } = payload;
                const subject = `${tokenIn} to ${tokenOut} on ${completedAccountId}`;
                const errorMessage = unconfirmed
                    ? `Swap status unknown for ${subject}. ${
                          hash
                              ? `Check transaction ${hash} before swapping again.`
                              : 'Check account history before swapping again.'
                      }`
                    : `${subject}${hash ? `. Transaction ${hash}` : ''}`;

                dispatch(
                    showCustomAlert({
                        success: success && !unconfirmed,
                        messageCodeHeader:
                            success && !unconfirmed ? 'swap.success' : 'swap.error',
                        errorMessage,
                    })
                );
            }
        },
        [isMounted]
    );

    const events = useMemo(
        () => ({
            setViewState(payload) {
                dispatchIfMounted(ACTION.SET_VIEW_STATE, payload);
            },
            setTokenIn(payload = null) {
                dispatchSwapAction({ type: ACTION.SET_TOKEN_IN, payload });
            },
            setTokenOut(payload = null) {
                dispatchSwapAction({ type: ACTION.SET_TOKEN_OUT, payload });
            },
            setAmountIn(payload) {
                dispatchSwapAction({ type: ACTION.SET_AMOUNT_IN, payload });
            },
            setSelectedQuote(payload) {
                dispatchIfMounted(ACTION.SET_SELECTED_QUOTE, payload);
            },
            setSlippage(payload) {
                dispatchIfMounted(ACTION.SET_SLIPPAGE, payload);
            },
            setSwapPending(payload) {
                dispatchIfMounted(ACTION.SET_SWAP_PENDING, payload);
            },
            setCompletedSwapState(payload) {
                dispatchIfMounted(ACTION.SET_COMPLETED_SWAP_STATE, payload);
            },
        }),
        []
    );

    const contextValue = useMemo(() => ({ swapState, events }), [swapState]);

    return <SwapContext.Provider value={contextValue}>{children}</SwapContext.Provider>;
}
