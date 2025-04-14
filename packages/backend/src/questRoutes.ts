// src/questRoutes.ts
import { Router } from "express";
import { supabase } from "./supabaseClient";
import {
  hasOpenedMinimilesToday,
  hasReceivedPaymentAbove5,
  hasSentPaymentAbove5,
  hasDoneOneMinipayAction,
  mintMiniPoints
} from "./questChecks";

const router = Router();

// Utility for today's date
function getTodayDateString(): string {
  return new Date().toISOString().split("T")[0];
}

/**
 * We store daily quests with quest_id, e.g.:
 * - "daily_openMinimiles"
 * - "daily_receivePayment"
 * - "daily_sendPayment"
 * - "daily_minipayAction"
 *
 * The claims table has unique (user_address, quest_id, claim_day).
 * claim_day = date like '2023-07-10'
 */

// 1) Open Minimiles
router.post("/daily/openMinimiles", async (req, res) => {
  try {
    const { userAddress } = req.body;
    if (!userAddress) {
      return res.status(400).json({ error: "Missing userAddress" });
    }

    const questId = "daily_openMinimiles";
    const claimDay = getTodayDateString();

    // Check if claimed
    const { data, error } = await supabase
      .from("claims")
      .select("*")
      .eq("user_address", userAddress)
      .eq("quest_id", questId)
      .eq("claim_day", claimDay)
      .single();

    if (error) {
      console.error("Supabase Error:", error);
      return res.status(500).json({ error: "Database error" });
    }

    if (data) {
      return res.status(400).json({ error: "Quest already claimed today." });
    }

    // Check chain logic
    const eligible = await hasOpenedMinimilesToday(userAddress);
    if (!eligible) {
      return res.status(400).json({
        error: "Not eligible: no open_minimiles action found for today."
      });
    }

    // Mint 5 points
    await mintMiniPoints(userAddress, 5n);

    // Insert record
    const { data: insertData, error: insertError } = await supabase
      .from("claims")
      .insert({
        user_address: userAddress,
        quest_id: questId,
        claim_day: claimDay
      })
      .select()
      .single();

    if (insertError) {
      console.error(insertError);
      return res.status(500).json({ error: "Failed to record claim" });
    }

    return res.json({
      success: true,
      message: "5 points awarded for opening Minimiles today!",
      claim: insertData
    });
  } catch (err: any) {
    console.error(err);
    return res.status(500).json({ error: err.message || "Unknown error" });
  }
});

// 2) Receive Payment above $5
router.post("/daily/receivePayment", async (req, res) => {
  try {
    const { userAddress } = req.body;
    if (!userAddress) {
      return res.status(400).json({ error: "Missing userAddress" });
    }

    const questId = "daily_receivePayment";
    const claimDay = getTodayDateString();

    // Check if claimed
    const { data, error } = await supabase
      .from("claims")
      .select("*")
      .eq("user_address", userAddress)
      .eq("quest_id", questId)
      .eq("claim_day", claimDay)
      .single();

    if (error) {
      console.error(error);
      return res.status(500).json({ error: "Database error" });
    }
    if (data) {
      return res.status(400).json({ error: "Quest already claimed today." });
    }

    // Check logic
    const eligible = await hasReceivedPaymentAbove5(userAddress);
    if (!eligible) {
      return res
        .status(400)
        .json({ error: "Not eligible: no $5+ receive_payment found for today." });
    }

    // Mint 5 points
    await mintMiniPoints(userAddress, 5n);

    // Insert record
    const { data: insertData, error: insertError } = await supabase
      .from("claims")
      .insert({ user_address: userAddress, quest_id: questId, claim_day: claimDay })
      .select()
      .single();

    if (insertError) {
      console.error(insertError);
      return res.status(500).json({ error: "Failed to record claim" });
    }

    return res.json({
      success: true,
      message: "5 points awarded for receiving a payment above $5!",
      claim: insertData
    });
  } catch (err: any) {
    console.error(err);
    return res.status(500).json({ error: err.message || "Unknown error" });
  }
});

// 3) Send Payment above $5
router.post("/daily/sendPayment", async (req, res) => {
  try {
    const { userAddress } = req.body;
    if (!userAddress) {
      return res.status(400).json({ error: "Missing userAddress" });
    }

    const questId = "daily_sendPayment";
    const claimDay = getTodayDateString();

    const { data, error } = await supabase
      .from("claims")
      .select("*")
      .eq("user_address", userAddress)
      .eq("quest_id", questId)
      .eq("claim_day", claimDay)
      .single();

    if (error) {
      console.error(error);
      return res.status(500).json({ error: "Database error" });
    }
    if (data) {
      return res.status(400).json({ error: "Quest already claimed today." });
    }

    const eligible = await hasSentPaymentAbove5(userAddress);
    if (!eligible) {
      return res.status(400).json({
        error: "Not eligible: no $5+ send_payment found for today."
      });
    }

    await mintMiniPoints(userAddress, 5n);

    // Insert
    const { data: insertData, error: insertError } = await supabase
      .from("claims")
      .insert({ user_address: userAddress, quest_id: questId, claim_day: claimDay })
      .select()
      .single();

    if (insertError) {
      console.error(insertError);
      return res.status(500).json({ error: "Failed to record claim" });
    }

    return res.json({
      success: true,
      message: "5 points awarded for sending a $5+ payment!",
      claim: insertData
    });
  } catch (err: any) {
    console.error(err);
    return res.status(500).json({ error: err.message || "Unknown error" });
  }
});

// 4) Do one Minipay action
router.post("/daily/minipayAction", async (req, res) => {
  try {
    const { userAddress } = req.body;
    if (!userAddress) {
      return res.status(400).json({ error: "Missing userAddress" });
    }

    const questId = "daily_minipayAction";
    const claimDay = getTodayDateString();

    const { data, error } = await supabase
      .from("claims")
      .select("*")
      .eq("user_address", userAddress)
      .eq("quest_id", questId)
      .eq("claim_day", claimDay)
      .single();

    if (error) {
      console.error(error);
      return res.status(500).json({ error: "Database error" });
    }
    if (data) {
      return res.status(400).json({ error: "Quest already claimed today." });
    }

    const eligible = await hasDoneOneMinipayAction(userAddress);
    if (!eligible) {
      return res.status(400).json({
        error: "Not eligible: no minipay_action found for today."
      });
    }

    // Mint 10 points
    await mintMiniPoints(userAddress, 10n);

    const { data: insertData, error: insertError } = await supabase
      .from("claims")
      .insert({ user_address: userAddress, quest_id: questId, claim_day: claimDay })
      .select()
      .single();

    if (insertError) {
      console.error(insertError);
      return res.status(500).json({ error: "Failed to record claim" });
    }

    return res.json({
      success: true,
      message: "10 points awarded for a Minipay ecosystem action!",
      claim: insertData
    });
  } catch (err: any) {
    console.error(err);
    return res.status(500).json({ error: err.message || "Unknown error" });
  }
});

export default router;
