import { StrikeView } from "@Cypher/components";
import { dispatchNavigate, formatStrikeNumber } from "@Cypher/helpers";
import { btc } from "@Cypher/helpers/coinosHelper";
import useAuthStore from "@Cypher/stores/authStore";
import React, { useState } from "react";
import SimpleToast from "react-native-simple-toast";


interface Props {
    matchedRate: any;
    currency: any;
}

export default function StrikeDollarWallet({
    matchedRate,
    currency,
}: Props) {
    const { isStrikeAuth } = useAuthStore();
    return (
        isStrikeAuth && <StrikeView currency={currency} matchedRate={matchedRate} />
    )
}
