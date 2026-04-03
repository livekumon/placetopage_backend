import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import {
  createOrder,
  captureOrder,
  getPaymentHistory,
  getPaymentById,
  getTokenPacks,
} from "../controllers/paymentController.js";

const router = Router();

// Public — no auth required to view available packs
router.get("/token-packs", getTokenPacks);

router.use(requireAuth);

router.post("/create-order", createOrder);
router.post("/capture-order", captureOrder);
router.get("/history", getPaymentHistory);
router.get("/:id", getPaymentById);

export default router;
