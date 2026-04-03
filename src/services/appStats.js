import { AppStats } from "../models/AppStats.js";

export async function recordLoginEvent() {
  try {
    await AppStats.findOneAndUpdate(
      { key: "global" },
      { $inc: { totalLoginEvents: 1 } },
      { upsert: true }
    );
  } catch (e) {
    console.error("recordLoginEvent:", e);
  }
}

export async function getLoginEventsTotal() {
  const doc = await AppStats.findOne({ key: "global" }).lean();
  return doc?.totalLoginEvents ?? 0;
}
