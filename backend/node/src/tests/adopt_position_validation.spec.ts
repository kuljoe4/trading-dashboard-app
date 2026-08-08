import "reflect-metadata";
import { validate } from "class-validator";
import { plainToInstance } from "class-transformer";
import { AdoptPositionDto } from "../trading/dto/session.dto";

describe("Sentinel: AdoptPositionDto Input Gating & Validation", () => {
  it("should accept valid symbols and strategy labels", async () => {
    const validCases = [
      { symbol: "BTCUSDT", strategyLabel: "Momentum Strategy" },
      { symbol: "ETHUSDT", strategyLabel: "Strategy (EMA 50 > 200)" },
      { symbol: "SOLUSDT", strategyLabel: "Variant_1" },
      { symbol: "XRPUSDT", strategyLabel: "Test-Label-123" },
      { symbol: "ADAUSDT", strategyLabel: "Strategy 100% []" },
    ];

    for (const testCase of validCases) {
      const dto = plainToInstance(AdoptPositionDto, {
        symbol: testCase.symbol,
        strategyLabel: testCase.strategyLabel,
        initialSl: 100,
        currentSl: 105,
      });
      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    }
  });

  it("should reject invalid symbols", async () => {
    const invalidSymbols = [
      "BTCUSDT_TOO_LONG_OF_A_SYMBOL_NAME",
      "btc-usdt", // must be uppercase
      "ETH;DROP", // dangerous chars
      "SOL<script>", // XSS
      "AB", // too short (usually 3 chars min)
    ];

    for (const symbol of invalidSymbols) {
      const dto = plainToInstance(AdoptPositionDto, {
        symbol,
        strategyLabel: "Valid Strategy Label",
      });
      const errors = await validate(dto);
      const symbolError = errors.find((e) => e.property === "symbol");
      expect(symbolError).toBeDefined();
    }
  });

  it("should reject strategy labels containing script tags or HTML-like structures", async () => {
    const xssPayloads = [
      '<script>alert("XSS")</script>',
      "<img src=x onerror=alert(1)>",
      '<<SCRIPT>alert("XSS")//<</SCRIPT>',
      '<div style="width:100px">Custom Strategy</div>',
    ];

    for (const payload of xssPayloads) {
      const dto = plainToInstance(AdoptPositionDto, {
        symbol: "BTCUSDT",
        strategyLabel: payload,
      });
      const errors = await validate(dto);
      const labelError = errors.find((e) => e.property === "strategyLabel");
      expect(labelError).toBeDefined();
      expect(labelError?.constraints?.matches).toBeDefined();
    }
  });

  it("should reject strategy labels containing disallowed dangerous characters", async () => {
    const dangerousLabels = [
      "Strategy; DROP TABLE sessions;",
      "Strategy\nwith\rnewlines",
      "Strategy\"with'quotes",
      "Strategy\\with\\backslashes",
    ];

    for (const label of dangerousLabels) {
      const dto = plainToInstance(AdoptPositionDto, {
        symbol: "BTCUSDT",
        strategyLabel: label,
      });
      const errors = await validate(dto);
      const labelError = errors.find((e) => e.property === "strategyLabel");
      expect(labelError).toBeDefined();
      expect(labelError?.constraints?.matches).toBeDefined();
    }
  });

  it("should reject overly long strategy labels", async () => {
    const dto = plainToInstance(AdoptPositionDto, {
      symbol: "BTCUSDT",
      strategyLabel: "A".repeat(101),
    });
    const errors = await validate(dto);
    const labelError = errors.find((e) => e.property === "strategyLabel");
    expect(labelError).toBeDefined();
    expect(labelError?.constraints?.maxLength).toBeDefined();
  });
});
