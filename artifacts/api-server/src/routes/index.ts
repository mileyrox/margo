import { Router, type IRouter } from "express";
import authRouter from "./auth";
import financeRouter from "./finance";
import extensionRouter from "./extension";
import healthRouter from "./health";
import purchaseIntelligenceRouter from "./purchase-intelligence";
import storageRouter from "./storage";
import plaidRouter from "./plaid";
import swapCatalogRouter from "./swap-catalog";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(financeRouter);
router.use(purchaseIntelligenceRouter);
router.use(extensionRouter);
router.use(storageRouter);
router.use(plaidRouter);
router.use(swapCatalogRouter);

export default router;
