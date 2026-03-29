import { StrikeView } from "@Cypher/components";
import { dispatchNavigate, formatStrikeNumber } from "@Cypher/helpers";
import { btc } from "@Cypher/helpers/coinosHelper";
import useAuthStore from "@Cypher/stores/authStore";
import React, { useState } from "react";
import SimpleToast from "react-native-simple-toast";


interface Props {
    matchedRateStrike: any;
    currency: any;
}

export default function StrikeDollarWallet({
    matchedRateStrike,
    currency,
}: Props) {
    const { isStrikeAuth } = useAuthStore();
    return (
        isStrikeAuth && <StrikeView currency={currency} matchedRateStrike={matchedRateStrike} />
    )
}
