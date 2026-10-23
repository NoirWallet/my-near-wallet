import Big from 'big.js';

export function formatPriceImpact(percent) {
    return Big(percent).round(2, Big.roundUp).toFixed(2);
}
