import Big from 'big.js';
import React from 'react';
import styled from 'styled-components';

import { PRICE_IMPACT_THRESHOLD } from '../utils/constants';
import { formatPriceImpact } from '../utils/formatPriceImpact';

const PriceImpactWrapper = styled.span`
    display: flex;
    align-items: center;
    flex-shrink: 0;
    white-space: nowrap;
    color: var(--mnw-color-success);

    &.error {
        color: var(--mnw-color-error);
    }

    &.warning {
        color: var(--mnw-color-warning);
    }
`;

export default function PriceImpact({ percent = '-' }) {
    const impact = percent === '-' ? null : Big(percent);
    const className = impact?.gt(PRICE_IMPACT_THRESHOLD.error)
        ? 'error'
        : impact?.gt(PRICE_IMPACT_THRESHOLD.warning)
        ? 'warning'
        : '';
    const displayedImpact = impact
        ? impact.lt('0.01')
            ? '< 0.01'
            : formatPriceImpact(percent)
        : '-';

    return (
        <PriceImpactWrapper className={className}>{displayedImpact} %</PriceImpactWrapper>
    );
}
