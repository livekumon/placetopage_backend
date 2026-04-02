import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import {
  createOrder,
  captureOrder,
  getPaymentHistory,
  getPaymentById,
} from "../controllers/paymentController.js";

const router = Router();

router.use(requireAuth);

router.post("/create-order", createOrder);
router.post("/capture-order", captureOrder);
router.get("/history", getPaymentHistory);
router.get("/:id", getPaymentById);

export default router;
