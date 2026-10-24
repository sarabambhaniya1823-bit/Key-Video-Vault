import { Router, type IRouter } from "express";
import healthRouter from "./health";
import accessRouter from "./access";

const router: IRouter = Router();

router.use(healthRouter);
router.use(accessRouter);

export default router;
