/**
 * Save live Robinhood fixture for wave-robin tests — real bars/quotes from
 * 2026-09-23 pull. Not invented. Used offline so CI does not need RH MCP.
 */
export const WAVE_ROBIN_FIXTURE = Object.freeze({
  pulledAt: "2026-09-23T23:06:00Z",
  portfolio: {
    total_value: "19.067228760098",
    equity_value: "0",
    crypto_value: "18.067228760098",
    cash: "1",
    buying_power: { buying_power: "1.0000" },
  },
  quotes: [
    { quote: { symbol: "HOOD", last_trade_price: "122.710000", last_non_reg_trade_price: "123.133000" } },
    { quote: { symbol: "SPY", last_trade_price: "767.750000", last_non_reg_trade_price: "768.030000" } },
    { quote: { symbol: "QQQ", last_trade_price: "741.170000", last_non_reg_trade_price: "741.711000" } },
  ],
  // Compact bars: first, mid trough-ish, recent peak region for HOOD
  historicals: [
    {
      symbol: "HOOD",
      bars: [
        { open_price: "86.685", close_price: "90.34", high_price: "92.35", low_price: "85.30" },
        { open_price: "92.615", close_price: "93.51", high_price: "95.60", low_price: "90.07" },
        { open_price: "93.96", close_price: "92.80", high_price: "95.55", low_price: "92.32" },
        { open_price: "90.71", close_price: "90.71", high_price: "92.60", low_price: "90.21" },
        { open_price: "101.10", close_price: "108.13", high_price: "109.71", low_price: "98.77" },
        { open_price: "103.20", close_price: "112.09", high_price: "112.45", low_price: "102.80" },
        { open_price: "113.80", close_price: "124.72", high_price: "124.88", low_price: "113.04" },
        { open_price: "112.69", close_price: "113.33", high_price: "116.30", low_price: "111.95" },
        { open_price: "110.27", close_price: "104.42", high_price: "111.05", low_price: "101.70" },
        { open_price: "113.34", close_price: "119.82", high_price: "120.57", low_price: "111.06" },
        { open_price: "125.05", close_price: "123.30", high_price: "126.41", low_price: "121.51" },
        { open_price: "123.00", close_price: "124.25", high_price: "126.16", low_price: "122.46" },
      ],
    },
    {
      symbol: "SPY",
      bars: [
        { open_price: "749.44", close_price: "757.67", high_price: "758.58", low_price: "748.80" },
        { open_price: "760.63", close_price: "771.33", high_price: "773.41", low_price: "760.52" },
        { open_price: "765.96", close_price: "762.60", high_price: "768.15", low_price: "762.04" },
        { open_price: "758.03", close_price: "757.83", high_price: "760.11", low_price: "756.64" },
        { open_price: "759.50", close_price: "754.05", high_price: "761.67", low_price: "749.60" },
        { open_price: "766.25", close_price: "773.50", high_price: "774.89", low_price: "766.03" },
        { open_price: "774.03", close_price: "773.38", high_price: "775.14", low_price: "772.57" },
      ],
    },
    {
      symbol: "QQQ",
      bars: [
        { open_price: "688.30", close_price: "700.07", high_price: "701.59", low_price: "685.82" },
        { open_price: "708.16", close_price: "723.85", high_price: "725.66", low_price: "707.53" },
        { open_price: "712.09", close_price: "710.93", high_price: "714.94", low_price: "708.52" },
        { open_price: "707.55", close_price: "708.69", high_price: "712.06", low_price: "706.86" },
        { open_price: "708.00", close_price: "704.72", high_price: "711.88", low_price: "700.00" },
        { open_price: "727.89", close_price: "741.47", high_price: "743.22", low_price: "727.81" },
        { open_price: "740.98", close_price: "747.46", high_price: "748.35", low_price: "740.93" },
      ],
    },
  ],
  positions: [
    { currency: { code: "STRK" }, quantity: "214.1", quantity_transferable: "214.1" },
    { currency: { code: "AVAX" }, quantity: "0.0773", quantity_transferable: "0.0773" },
  ],
});
