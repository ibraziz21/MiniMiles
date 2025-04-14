// src/questRoutes.ts
import { Router } from "express";
import { supabase } from "./supabaseClient";
import { has25Transactions, hasTransferred5USDT, mintMiniPoints } from "./questChecks";

const router = Router();

/**
 * /claim/25tx
 * Checks if user has >=25 transactions.
 */
router.post("/25tx", async (req, res) => {
  try {
    const { userAddress } = req.body;
    if (!userAddress) {
      return res.status(400).json({ error: "Missing userAddress" });
    }

    // 1) Check DB to see if user already claimed
    const questId = "25tx";
    const { data, error } = await supabase
      .from("claims")
      .select("*")
      .eq("user_address", userAddress)
      .eq("quest_id", questId)
      .single();

    if (error) {
      console.error("Supabase Error:", error);
      return res.status(500).json({ error: "Database error" });
    }
    if (data) {
      return res.status(400).json({ error: "Quest already claimed" });
    }

    // 2) Check chain logic
    const eligible = await has25Transactions(userAddress);
    if (!eligible) {
      return res.status(400).json({ error: "Not eligible (not 25 tx yet)." });
    }

    // 3) Mint points
    const pointsToMint = 20n; // or BigInt(20)
    await mintMiniPoints(userAddress, pointsToMint);

    // 4) Insert record
    const { data: insertData, error: insertError } = await supabase
      .from("claims")
      .insert({ user_address: userAddress, quest_id: questId })
      .select()
      .single();

    if (insertError) {
      console.error(insertError);
      return res.status(500).json({ error: "Failed to record claim" });
    }

    return res.json({
      success: true,
      message: "MiniPoints awarded!",
      claim: insertData
    });
  } catch (err: any) {
    console.error(err);
    return res.status(500).json({ error: err.message || "Unknown error" });
  }
});

/**
 * /claim/transfer5usdt
 * Checks if user has done a 5 USDT transfer.
 */
router.post("/transfer5usdt", async (req, res) => {
  try {
    const { userAddress } = req.body;
    if (!userAddress) {
      return res.status(400).json({ error: "Missing userAddress" });
    }

    // 1) Check DB
    const questId = "transfer5usdt";
    const { data, error } = await supabase
      .from("claims")
      .select("*")
      .eq("user_address", userAddress)
      .eq("quest_id", questId)
      .single();

    if (error) {
      console.error("Supabase Error:", error);
      return res.status(500).json({ error: "Database error" });
    }
    if (data) {
      return res.status(400).json({ error: "Quest already claimed" });
    }

    // 2) Check chain logic
    const eligible = await hasTransferred5USDT(userAddress);
    if (!eligible) {
      return res.status(400).json({ error: "Not eligible (no 5 USDT transfer found)" });
    }

    // 3) Mint points
    const pointsToMint = 30n;
    await mintMiniPoints(userAddress, pointsToMint);

    // 4) Insert record
    const { data: insertData, error: insertError } = await supabase
      .from("claims")
      .insert({ user_address: userAddress, quest_id: questId })
      .select()
      .single();

    if (insertError) {
      console.error(insertError);
      return res.status(500).json({ error: "Failed to record claim" });
    }

    return res.json({
      success: true,
      message: "MiniPoints awarded!",
      claim: insertData
    });
  } catch (err: any) {
    console.error(err);
    return res.status(500).json({ error: err.message || "Unknown error" });
  }
});

export default router;
