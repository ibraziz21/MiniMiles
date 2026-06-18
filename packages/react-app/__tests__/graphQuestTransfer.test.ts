import { beforeEach, describe, expect, it, vi } from "vitest";

const getBlockNumberMock = vi.hoisted(() => vi.fn());
const getLogsMock = vi.hoisted(() => vi.fn());

vi.mock("viem", () => ({
  createPublicClient: vi.fn(() => ({
    getBlockNumber: getBlockNumberMock,
    getLogs: getLogsMock,
  })),
  http: vi.fn((url?: string) => ({ url })),
  parseAbiItem: vi.fn((abi: string) => abi),
}));

const USER = "0x9889eef6885eae316c23bfb594e6e1e92c1abd82";
const CUSD_ADDRESS = "0x765de816845861e75a25fca122bb6898b8b1282a";
const ONE_CUSD = 10n ** 18n;

function getLogCall(index: number) {
  return getLogsMock.mock.calls[index]?.[0] as {
    address: string;
    fromBlock: bigint;
    toBlock: bigint;
  };
}

function rangeError() {
  return Object.assign(new Error("HTTP request failed"), {
    details: '{"code":-32602,"message":"query exceeds range, retry smaller"}',
    shortMessage: "HTTP request failed.",
  });
}

describe("graphQuestTransfer RPC checks", () => {
  beforeEach(() => {
    vi.resetModules();
    getBlockNumberMock.mockReset();
    getLogsMock.mockReset();
  });

  it("uses chunked RPC log requests and stops once it finds a qualifying transfer", async () => {
    getBlockNumberMock.mockResolvedValue(10_000n);
    getLogsMock
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ args: { value: 2n * ONE_CUSD } }]);

    const { userSentAtLeast1DollarIn24Hrs } = await import(
      "@/helpers/graphQuestTransfer"
    );

    await expect(userSentAtLeast1DollarIn24Hrs(USER)).resolves.toBe(true);

    expect(getLogsMock).toHaveBeenCalledTimes(2);

    expect(getLogCall(0)).toMatchObject({
      address: CUSD_ADDRESS,
      fromBlock: 6001n,
      toBlock: 10_000n,
    });
    expect(getLogCall(1)).toMatchObject({
      address: CUSD_ADDRESS,
      fromBlock: 2001n,
      toBlock: 6000n,
    });
  });

  it("splits a chunk again when the RPC provider still rejects the range", async () => {
    getBlockNumberMock.mockResolvedValue(10_000n);
    getLogsMock
      .mockRejectedValueOnce(rangeError())
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ args: { value: 2n * ONE_CUSD } }]);

    const { userSentAtLeast1DollarIn24Hrs } = await import(
      "@/helpers/graphQuestTransfer"
    );

    await expect(userSentAtLeast1DollarIn24Hrs(USER)).resolves.toBe(true);

    expect(getLogsMock).toHaveBeenCalledTimes(3);
    expect(getLogCall(0)).toMatchObject({
      fromBlock: 6001n,
      toBlock: 10_000n,
    });
    expect(getLogCall(1)).toMatchObject({
      fromBlock: 6001n,
      toBlock: 8000n,
    });
    expect(getLogCall(2)).toMatchObject({
      fromBlock: 8001n,
      toBlock: 10_000n,
    });
  });

  it("counts outgoing transfers across RPC-scanned stablecoin logs", async () => {
    getBlockNumberMock.mockResolvedValue(3_000n);
    getLogsMock
      .mockResolvedValueOnce([
        { args: { value: ONE_CUSD } },
        { args: { value: ONE_CUSD - 1n } },
      ])
      .mockResolvedValueOnce([
        { args: { value: 1_000_000n } },
        { args: { value: 2_000_000n } },
      ])
      .mockResolvedValueOnce([]);

    const { countOutgoingTransfersIn24H } = await import(
      "@/helpers/graphQuestTransfer"
    );

    await expect(countOutgoingTransfersIn24H(USER)).resolves.toBe(3);

    expect(getLogsMock).toHaveBeenCalledTimes(3);
  });
});
