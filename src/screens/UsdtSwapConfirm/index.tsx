import React from "react";

import type { SwapDirection } from "@Cypher/services/tron/swapConvert";

import QuoteConfirm from "./QuoteConfirm";
import SwapReview from "./SwapReview";

interface Props {
    route: {
        params?: {
            /* From the USDT card's converter: a direction and both amounts. */
            direction?: SwapDirection;
            sendAmount?: string;
            receiveAmount?: string;
            rate?: string | null;
            /* From the amount and destination screens: a pasted destination. */
            amount?: string;
            destination?: string;
        };
    };
}

/**
 * Review a swap, whichever way the user got here.
 *
 * Two routes lead in and they need different screens, so this picks between
 * them on the params rather than making one screen do both:
 *
 *   - The card's converter sends a direction and the two amounts it worked
 *     out, and no destination, because the bitcoin side is a wallet the user
 *     picks here. That is SwapReview.
 *   - The amount and destination screens send an amount and a destination the
 *     user pasted, scanned or picked. That is QuoteConfirm, which books the
 *     quote and pays it.
 *
 * Both are registered under this one route name, so the card and the older
 * flow can keep the navigation they already had.
 */
export default function UsdtSwapConfirm({ route }: Props) {
    const params = route?.params ?? {};

    if (params.direction && params.sendAmount && params.receiveAmount) {
        return (
            <SwapReview
                direction={params.direction}
                sendAmount={params.sendAmount}
                receiveAmount={params.receiveAmount}
                rate={params.rate ?? null}
            />
        );
    }

    return <QuoteConfirm amount={params.amount ?? ''} destinationRaw={params.destination ?? ''} />;
}
