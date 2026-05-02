import { autoAcceptPlacedOrders } from "@/lib/orderAutoAccept";

type SelectResult = { data: Array<{ id: string }> | null; error: { message: string } | null };

function createSupabaseMock(results: SelectResult[]) {
  const eq = jest.fn().mockReturnThis();
  const lte = jest.fn().mockReturnThis();
  const select = jest.fn<Promise<SelectResult>, [string]>();
  for (const r of results) {
    select.mockResolvedValueOnce(r);
  }

  const update = jest.fn((_: Record<string, unknown>) => ({ eq, lte, select }));
  const from = jest.fn(() => ({ update }));

  return {
    client: { from },
    spies: { from, update, eq, lte, select },
  };
}

describe("autoAcceptPlacedOrders", () => {
  it("updates stale placed orders to confirmed", async () => {
    const mock = createSupabaseMock([
      { data: [{ id: "o-1" }, { id: "o-2" }], error: null },
    ]);

    const result = await autoAcceptPlacedOrders({
      supabase: mock.client as never,
      canteenId: "c-1",
      ageSeconds: 35,
    });

    expect(result.updatedCount).toBe(2);
    expect(mock.spies.from).toHaveBeenCalledWith("orders");
    expect(mock.spies.update).toHaveBeenCalledTimes(1);
    expect(mock.spies.eq).toHaveBeenCalledWith("status", "placed");
    expect(mock.spies.eq).toHaveBeenCalledWith("canteen_id", "c-1");
    expect(mock.spies.lte).toHaveBeenCalledWith("created_at", expect.any(String));
  });

  it("applies user filter when userId is provided", async () => {
    const mock = createSupabaseMock([
      { data: [{ id: "o-9" }], error: null },
    ]);

    const result = await autoAcceptPlacedOrders({
      supabase: mock.client as never,
      userId: "u-1",
    });

    expect(result.updatedCount).toBe(1);
    expect(mock.spies.eq).toHaveBeenCalledWith("user_id", "u-1");
  });

  it("retries without updated_at for older schema", async () => {
    const mock = createSupabaseMock([
      { data: null, error: { message: 'column "updated_at" does not exist' } },
      { data: [{ id: "o-3" }], error: null },
    ]);

    const result = await autoAcceptPlacedOrders({
      supabase: mock.client as never,
    });

    expect(result.updatedCount).toBe(1);
    expect(mock.spies.update).toHaveBeenCalledTimes(2);
    const firstPayload = mock.spies.update.mock.calls[0][0] as Record<string, unknown>;
    const secondPayload = mock.spies.update.mock.calls[1][0] as Record<string, unknown>;
    expect(firstPayload.status).toBe("confirmed");
    expect(firstPayload.updated_at).toBeTruthy();
    expect(secondPayload.status).toBe("confirmed");
    expect(secondPayload.updated_at).toBeUndefined();
  });
});