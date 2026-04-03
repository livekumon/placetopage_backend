import mongoose from "mongoose";
import { paypal, getPayPalClient } from "../config/paypal.js";
import { Payment } from "../models/Payment.js";
import { User } from "../models/User.js";
import { TOKEN_PACK_MAP, TOKEN_PACKS } from "../config/tokenPacks.js";

const FRONTEND_URL = () =>
  (process.env.FRONTEND_URL || "http://localhost:5173").replace(/\/$/, "");

/** Resolve pack data for a given productType. Falls back to env-based single-pack for 'go_live'. */
function resolvePack(productType) {
  if (TOKEN_PACK_MAP[productType]) return TOKEN_PACK_MAP[productType];

  if (productType === "go_live") {
    const raw = process.env.PAYPAL_GO_LIVE_AMOUNT_USD;
    const amount = raw != null && raw !== "" ? Number(raw) : 5;
    const rawC = process.env.PAYPAL_GO_LIVE_PUBLISHING_CREDITS;
    const credits = rawC != null && rawC !== "" ? Number.parseInt(String(rawC), 10) : 1;
    return {
      id: "go_live",
      credits: Number.isFinite(credits) && credits > 0 ? credits : 1,
      amountUsd: Number.isFinite(amount) && amount >= 0 ? amount : 5,
      label: "Go Live",
      description: "Publish your site to placetopage.com",
    };
  }

  return null;
}

export async function getTokenPacks(_req, res) {
  res.json({ packs: TOKEN_PACKS });
}

export async function createOrder(req, res, next) {
  try {
    if (!process.env.PAYPAL_CLIENT_ID || !process.env.PAYPAL_CLIENT_SECRET) {
      return res.status(503).json({
        message: "PayPal is not configured. Set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET.",
      });
    }

    const productType = String(req.body?.productType || "go_live");
    const pack = resolvePack(productType);
    if (!pack) {
      return res.status(400).json({ message: "Unsupported productType" });
    }

    const amount = pack.amountUsd;
    const creditsGranted = pack.credits;
    const userId = req.userId;

    const request = new paypal.orders.OrdersCreateRequest();
    request.prefer("return=representation");
    request.requestBody({
      intent: "CAPTURE",
      purchase_units: [
        {
          description: `${pack.label} — ${creditsGranted} publish credit${creditsGranted !== 1 ? "s" : ""} on placetopage.com`,
          amount: {
            currency_code: "USD",
            value: amount.toFixed(2),
          },
          reference_id: productType,
        },
      ],
      application_context: {
        brand_name: "Place to Page",
        landing_page: "NO_PREFERENCE",
        user_action: "PAY_NOW",
        return_url: `${FRONTEND_URL()}/purchase-tokens?paypal=success`,
        cancel_url: `${FRONTEND_URL()}/purchase-tokens?paypal=cancelled`,
      },
    });

    const order = await getPayPalClient().execute(request);

    const payment = await Payment.create({
      userId,
      paypalOrderId: order.result.id,
      amount,
      currency: "USD",
      status: "created",
      productType,
      publishingCreditsGranted: creditsGranted,
      paypalResponse: order.result,
    });

    res.status(201).json({
      orderId: order.result.id,
      paymentId: String(payment._id),
      amountUsd: amount,
      publishingCreditsGranted: creditsGranted,
    });
  } catch (e) {
    console.error("createOrder error:", e);
    next(e);
  }
}

export async function captureOrder(req, res, next) {
  try {
    const { orderId } = req.body;
    if (!orderId) {
      return res.status(400).json({ message: "orderId is required" });
    }
    const userId = req.userId;

    const payment = await Payment.findOne({
      paypalOrderId: orderId,
      userId,
    });

    if (!payment) {
      return res.status(404).json({ message: "Payment not found" });
    }
    if (payment.status === "completed") {
      return res.status(400).json({ message: "Payment already completed" });
    }

    const captureReq = new paypal.orders.OrdersCaptureRequest(orderId);
    captureReq.requestBody({});

    const capture = await getPayPalClient().execute(captureReq);

    if (capture.result.status === "COMPLETED") {
      const session = await mongoose.startSession();
      session.startTransaction();
      try {
        payment.status = "completed";
        const pu = capture.result.purchase_units?.[0];
        const cap = pu?.payments?.captures?.[0];
        payment.paypalPaymentId = cap?.id;
        payment.paypalResponse = capture.result;
        payment.completedAt = new Date();
        const payer = capture.result.payer;
        if (payer?.email_address) payment.payerEmail = payer.email_address;
        if (payer?.name) {
          const g = payer.name.given_name || "";
          const s = payer.name.surname || "";
          payment.payerName = `${g} ${s}`.trim();
        }
        await payment.save({ session });

        const user = await User.findById(userId).session(session);
        if (!user) throw new Error("User not found");
        user.publishingCredits = (user.publishingCredits || 0) + payment.publishingCreditsGranted;
        await user.save({ session });

        await session.commitTransaction();
      } catch (err) {
        await session.abortTransaction();
        throw err;
      } finally {
        session.endSession();
      }

      const user = await User.findById(userId).lean();
      return res.json({
        payment: {
          id: String(payment._id),
          status: payment.status,
          publishingCreditsGranted: payment.publishingCreditsGranted,
        },
        user: {
          publishingCredits: user?.publishingCredits ?? 0,
          creditsRemaining: user?.creditsRemaining ?? 0,
        },
      });
    }

    payment.status = "failed";
    payment.paypalResponse = capture.result;
    await payment.save();

    return res.status(400).json({
      message: `Payment not completed. Status: ${capture.result.status}`,
    });
  } catch (e) {
    console.error("captureOrder error:", e);
    next(e);
  }
}

export async function getPaymentHistory(req, res, next) {
  try {
    const payments = await Payment.find({ userId: req.userId })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();

    res.json({ payments, count: payments.length });
  } catch (e) {
    next(e);
  }
}

export async function getPaymentById(req, res, next) {
  try {
    const payment = await Payment.findOne({
      _id: req.params.id,
      userId: req.userId,
    }).lean();

    if (!payment) {
      return res.status(404).json({ message: "Payment not found" });
    }
    res.json({ payment });
  } catch (e) {
    next(e);
  }
}
