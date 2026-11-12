import { Router, type IRouter } from "express";
import { requireAuth } from "../middlewares/requireAuth";
import financeRouter from "./finance";
import extensionRouter from "./extension";
import healthRouter from "./health";
import purchaseIntelligenceRouter from "./purchase-intelligence";
import storageRouter from "./storage";
import plaidRouter from "./plaid";
import swapCatalogRouter from "./swap-catalog";
import swapEngineRouter from "./swap-engine";
import receiptEmailRouter from "./receipt-email";

const router: IRouter = Router();

router.use(healthRouter);
router.use([
  "/finance", "/transactions", "/receipts", "/comparisons", "/budget-plan", "/swap-profile", "/settings", "/account",
  "/purchase-history", "/products", "/product-alternatives",
  "/extension/tokens", "/plaid", "/swap-catalog", "/swaps", "/admin",
  "/storage/uploads", "/storage/objects",
], requireAuth);
router.use(financeRouter);
router.use(purchaseIntelligenceRouter);
router.use(extensionRouter);
router.use(storageRouter);
router.use(plaidRouter);
router.use(swapCatalogRouter);
router.use(swapEngineRouter);
router.use(receiptEmailRouter);

export default router;
