import { Router, type IRouter } from "express";
import authRouter from "./auth";
import financeRouter from "./finance";
import healthRouter from "./health";
import purchaseIntelligenceRouter from "./purchase-intelligence";
import storageRouter from "./storage";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(financeRouter);
router.use(purchaseIntelligenceRouter);
router.use(storageRouter);

export default router;
