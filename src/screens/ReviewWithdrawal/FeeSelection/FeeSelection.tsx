import React, { useState } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';

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
    fastestFee: "Fastest",
    halfHourFee: "Fast",
    hourFee: "Medium",
    economyFee: "Slow",
  };
  const handleFeeSelection = (fee: Fee) => {
    console.log('fee: ', fee)
    onFeeSelect(fee);
  };

  // Last line of defence. Callers now seed with static tiers, but this component
  // used to render Object.entries([]) whenever the fee lookup had not landed,
  // which produces literally nothing: the sheet opens, the chevron animates, and
  // there is no list and no explanation. Reported from the field as "the select
  // fee button is not working". An empty selector must always say why it is
  // empty rather than looking like a dead control.
  const entries = Object.entries(fees ?? {}).filter(
    ([feeKey, feeValue]) => feeKey !== 'minimumFee' && Number.isFinite(Number(feeValue)),
  );

  if (entries.length === 0) {
    return (
      <View>
        <Text style={{ color: 'white', marginVertical: 10 }}>
          Fee rates are still loading. If this does not clear, check your connection and try again.
        </Text>
      </View>
    );
  }

  return (
    <View>
        {entries.map(([feeKey, feeValue]) => (
            (
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
                <Text style={{color: 'white'}}>{feeNames[feeKey as Fee]}: {feeValue} sat/vB</Text>
                </TouchableOpacity>
            )
        ))}
    </View>
  );
};
