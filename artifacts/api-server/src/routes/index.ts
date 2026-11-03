import { Router, type IRouter } from "express";
import authRouter from "./auth";
import financeRouter from "./finance";
import healthRouter from "./health";
import storageRouter from "./storage";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(financeRouter);
router.use(storageRouter);

export default router;
