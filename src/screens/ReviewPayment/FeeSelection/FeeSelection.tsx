import React, { useState } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import loc from '../../../../loc';

type Fee = keyof Fees;

type Fees = {
  fastestFee: number;
  halfHourFee: number;
  hourFee: number;
  economyFee: number;
};

type FeeSelectionProps = {
  fees: Fees;
  disabled: boolean;
  selectedName: string | null;
  onFeeSelect: (fee: string) => void;
  onSelectFeeName: (val: string) => void;
};

export const FeeSelection: React.FC<FeeSelectionProps> = ({ disabled = false, selectedName, fees, onFeeSelect, onSelectFeeName }) => {
  const feeNames: Record<Fee, string> = {
    fastestFee: loc.cypherbox.payments.common.fee_fastest,
    halfHourFee: loc.cypherbox.payments.common.fee_fast,
    hourFee: loc.cypherbox.payments.common.fee_medium,
    economyFee: loc.cypherbox.payments.common.fee_slow,
  };
  const handleFeeSelection = (fee: Fee) => {
    console.log('fee: ', fee)
    onFeeSelect(fee);
  };

  return (
    <View>
        {Object.entries(fees).map(([feeKey, feeValue]) => (
            feeKey !== 'minimumFee' && (
                <TouchableOpacity
                key={feeKey}
                onPress={() => handleFeeSelection(feeKey as Fee)}
                disabled={disabled}
                style={{ flexDirection: 'row', alignItems: 'center', marginVertical: 10 }}
                >
                <View style={{ width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: 'white', marginRight: 10, justifyContent: 'center', alignItems: 'center' }}>
                    {/* Use selectedFee prop to determine if the fee is selected */}
                    {selectedName === feeKey && <View style={{ width: 14, height: 14, borderRadius: 7, backgroundColor: 'white' }} />}
                </View>
                <Text style={{color: 'white'}}>{feeNames[feeKey as Fee]} &mdash; {feeValue} sats</Text>
                </TouchableOpacity>
            )
        ))}
    </View>
  );
};
