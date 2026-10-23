import Big from 'big.js';
import React, { useEffect, useRef, useState } from 'react';
import { useDispatch } from 'react-redux';
import styled from 'styled-components';

import CONFIG from '../../../config';
import { showCustomAlert } from '../../../redux/actions/status';
import { actions as swapActions } from '../../../redux/slices/swap';
import fungibleTokenExchange from '../../../services/tokenExchange';
import { fromRaw } from '../../../services/tokenExchange/quotes';
import { openTransactionInExplorer } from '../../../utils/window';

const Container = styled.section`
    border-top: 1px solid #e6e6e6;
    margin-top: 20px;
    padding-top: 16px;
    width: 100%;

    header,
    .asset {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
    }

    header {
        font-weight: 600;
    }
    .asset {
        padding: 12px 0;
    }
    .asset + .asset {
        border-top: 1px solid #f0f0f1;
    }
    .amount {
        min-width: 0;
        overflow-wrap: anywhere;
    }
    button {
        background: none;
        border: 0;
        color: var(--mnw-color-1);
        cursor: pointer;
        font: inherit;
        padding: 4px;
    }
    button:disabled {
        cursor: default;
        opacity: 0.5;
    }
    .message {
        color: #72727a;
        margin: 8px 0 0;
    }
`;

export default function RecoverableBalances({ account }) {
    const dispatch = useDispatch();
    const [balances, setBalances] = useState([]);
    const [loading, setLoading] = useState(false);
    const [withdrawingId, setWithdrawingId] = useState(null);
    const [error, setError] = useState('');
    const [pendingWithdrawal, setPendingWithdrawal] = useState(null);
    const requestId = useRef(0);
    const mounted = useRef(true);
    const accountId = account?.accountId;
    const currentAccountId = useRef(accountId);
    currentAccountId.current = accountId;

    useEffect(() => {
        mounted.current = true;
        return () => {
            mounted.current = false;
            requestId.current += 1;
        };
    }, [accountId]);

    const refresh = async (preserveError = false) => {
        if (!CONFIG.IS_MAINNET || !accountId) {
            return;
        }
        const id = ++requestId.current;
        setLoading(true);
        if (!preserveError) {
            setError('');
        }
        try {
            const result = await fungibleTokenExchange.getRecoverableBalances(account);
            if (mounted.current && id === requestId.current) {
                setBalances(
                    (result || []).filter(({ amount }) => Big(amount || 0).gt(0))
                );
            }
        } catch (cause) {
            if (mounted.current && id === requestId.current) {
                setError(cause.message || 'Unable to check available balances.');
            }
        } finally {
            if (mounted.current && id === requestId.current) {
                setLoading(false);
            }
        }
    };

    useEffect(() => {
        setBalances([]);
        setPendingWithdrawal(null);
        refresh();
    }, [accountId]);

    const withdraw = async (tokenId) => {
        if (!accountId || withdrawingId || pendingWithdrawal) {
            return;
        }
        setWithdrawingId(tokenId);
        setError('');
        const isCurrent = () => mounted.current && currentAccountId.current === accountId;
        try {
            const result = await fungibleTokenExchange.withdraw({
                account,
                tokenId,
                isCurrent,
            });
            if (!isCurrent()) {
                return;
            }
            if (result.retry) {
                setError('Connect your Ledger and try again.');
            } else if (result.unconfirmed) {
                const hash = result.swapTxHash || null;
                setPendingWithdrawal({ hash, tokenId });
                setError(
                    hash
                        ? 'Withdrawal status unknown. Check its transaction status before trying again.'
                        : 'Withdrawal status unknown. Check your account activity before trying again.'
                );
            } else if (!result.success) {
                setError(result.failReason || 'Withdrawal failed.');
            } else {
                dispatch(
                    swapActions.updateTokensBalance({ accountId, tokenIds: [tokenId] })
                );
                dispatch(
                    showCustomAlert({
                        success: true,
                        messageCodeHeader: 'success',
                        errorMessage: 'Balance withdrawn.',
                    })
                );
            }
        } catch (cause) {
            if (isCurrent()) {
                setError(cause.message || 'Withdrawal failed.');
            }
        } finally {
            if (isCurrent()) {
                await refresh(true);
                setWithdrawingId(null);
            }
        }
    };

    const checkWithdrawal = async () => {
        if (!pendingWithdrawal?.hash || !accountId || loading) {
            return;
        }
        const { hash, tokenId } = pendingWithdrawal;
        const isCurrent = () => mounted.current && currentAccountId.current === accountId;
        setLoading(true);
        try {
            const result = await fungibleTokenExchange.checkWithdrawalResult({
                account,
                hash,
                tokenId,
            });
            if (!isCurrent()) {
                return;
            }
            if (result.unconfirmed) {
                setError('Withdrawal is still pending. Check again later.');
            } else {
                setPendingWithdrawal(null);
                setError(result.success ? '' : result.failReason || 'Withdrawal failed.');
                dispatch(
                    swapActions.updateTokensBalance({ accountId, tokenIds: [tokenId] })
                );
            }
            await refresh(true);
        } catch (cause) {
            if (isCurrent()) {
                setError(cause.message || 'Unable to check withdrawal status.');
            }
        } finally {
            if (isCurrent()) {
                setLoading(false);
            }
        }
    };

    if (!CONFIG.IS_MAINNET || (!balances.length && !error)) {
        return null;
    }

    return (
        <Container>
            <header>
                <span>Available from swaps</span>
                <button
                    type='button'
                    onClick={() => refresh()}
                    disabled={loading || !!withdrawingId}
                >
                    {loading ? 'Refreshing...' : 'Refresh'}
                </button>
            </header>
            {balances.map(({ tokenId, amount, metadata }) => {
                const hasDecimals = Number.isInteger(metadata?.decimals);
                const displayAmount = hasDecimals
                    ? fromRaw(amount, metadata.decimals)
                    : `${amount} units`;
                return (
                    <div className='asset' key={tokenId}>
                        <span className='amount'>
                            {displayAmount} {metadata?.symbol || tokenId}
                        </span>
                        <button
                            type='button'
                            onClick={() => withdraw(tokenId)}
                            disabled={!!withdrawingId || !!pendingWithdrawal}
                        >
                            {withdrawingId === tokenId ? 'Withdrawing...' : 'Withdraw'}
                        </button>
                    </div>
                );
            })}
            {error && <p className='message'>{error}</p>}
            {pendingWithdrawal && (
                <div>
                    {pendingWithdrawal.hash && (
                        <>
                            <button
                                type='button'
                                onClick={checkWithdrawal}
                                disabled={loading}
                            >
                                Check status
                            </button>
                            <button
                                type='button'
                                onClick={() =>
                                    openTransactionInExplorer(pendingWithdrawal.hash)
                                }
                            >
                                View transaction
                            </button>
                        </>
                    )}
                </div>
            )}
        </Container>
    );
}
