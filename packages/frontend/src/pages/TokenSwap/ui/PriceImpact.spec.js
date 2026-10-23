import React from 'react';
import ReactDOM from 'react-dom';
import { act } from 'react-dom/test-utils';

import PriceImpact from './PriceImpact';

jest.mock('../utils/constants', () => ({
    PRICE_IMPACT_THRESHOLD: { warning: 2, error: 6 },
}));

describe('swap price impact', () => {
    let root;

    beforeEach(() => {
        root = document.createElement('div');
        document.body.appendChild(root);
    });

    afterEach(() => {
        act(() => {
            ReactDOM.unmountComponentAtNode(root);
        });
        root.remove();
    });

    function render(percent) {
        act(() => {
            ReactDOM.render(<PriceImpact percent={percent} />, root);
        });
        return root.firstElementChild;
    }

    test('bounds a high precision quote in the actual details component', () => {
        const element = render(
            '0.359610492957746478873239436619718309859154929577464788732394366'
        );
        expect(element.textContent).toBe('0.36 %');
        expect(element.classList.contains('warning')).toBe(false);
    });

    test.each(['0', '-0.01', '0.000001'])(
        'shows an impact below display precision: %s',
        (percent) => {
            expect(render(percent).textContent).toBe('< 0.01 %');
        }
    );

    test.each([
        ['2', '2.00 %', ''],
        ['2.0000000000000000000001', '2.01 %', 'warning'],
        ['6', '6.00 %', 'warning'],
        ['6.0000000000000000000001', '6.01 %', 'error'],
    ])('uses the exact impact for threshold styling: %s', (percent, label, level) => {
        const element = render(percent);
        expect(element.textContent).toBe(label);
        expect(element.classList.contains('warning')).toBe(level === 'warning');
        expect(element.classList.contains('error')).toBe(level === 'error');
    });
});
