function formatStrikeNumber(num: number) {
    if (num >= 1_000_000) {
        const millions = num / 1_000_000;
        return `${millions % 1 === 0 ? millions.toFixed(0) : millions.toFixed(1)}M`;
    } else if (num >= 1_000) {
        const thousands = num / 1_000;
        return `${thousands % 1 === 0 ? thousands.toFixed(0) : thousands.toFixed(1)}K`;
    }
    return `${num}`;
}

export default formatStrikeNumber;
